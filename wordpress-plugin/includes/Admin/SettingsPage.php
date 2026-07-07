<?php
/**
 * SettingsPage — the manage_options-gated wp-admin settings page.
 *
 * Renders a plain WP Settings API form (D-01) on a top-level wp-admin menu
 * item "Khavee AI Avatar" (D-02) with five fields: API key (masked, D-05/
 * D-06/D-07/D-08), personality/instructions textarea (SET-02), voice
 * dropdown (SET-03/D-04), and a VRM/GLB avatar picker (SET-04/ASSET-01,
 * D-09/D-10/D-11, added by 07-03). The page is the FIRST code path that
 * WRITES the `khaveeai_settings` option blob Phase 6's WpOptionsConfigSource
 * only reads.
 *
 * Security invariants (SET-05, T-07B-01/T-07B-03):
 *  - Capability is checked at TWO layers: the `manage_options` arg passed to
 *    add_menu_page() AND an independent current_user_can('manage_options')
 *    re-check as the FIRST statement of render_page(). The menu arg only
 *    HIDES the link (Pitfall 3); direct navigation to
 *    admin.php?page=khaveeai-settings must also be blocked.
 *  - The stored API key is NEVER placed in any HTML attribute. The key
 *    field's value attribute is always mask_api_key()'s output
 *    (sk-••••••<last4>), never the raw key (T-07B-03).
 *  - The avatar upload's content-validation filters (khaveeai_validate_glb_vrm_content,
 *    khaveeai_allow_glb_vrm_mimes) are registered on admin_init, scoped to
 *    requests that target or originate (via Referer) from this settings
 *    screen AND carry a verifiable plugin-issued nonce (CR-02) — see
 *    maybe_register_avatar_upload_filters() for why load-<hook_suffix> does
 *    NOT work for this (Open Question 2 / Assumption A2 resolution,
 *    T-07C-01/T-07C-02/T-07C-03) — never globally — and render_avatar_field()
 *    re-asserts current_user_can('manage_options') as defense-in-depth for
 *    the upload surface specifically (T-07C-04). The Referer/page condition
 *    alone is spoofable by a non-browser HTTP client or a forged Referer
 *    header; is_khaveeai_upload_request() ANDs in a wp_verify_nonce() check
 *    (action: khaveeai_avatar_upload) so a forged Referer alone can no
 *    longer activate the filters — the request must also carry a nonce this
 *    plugin's own render_avatar_field() issued (CR-02, T-07D-02).
 *
 * @package Khavee\Plugin\Admin
 */

namespace Khavee\Plugin\Admin;

use Khavee\Plugin\ConfigSource\ConfigSourceInterface;
use Khavee\Plugin\Platform\PlatformClient;

/**
 * Allow .glb and .vrm extensions through the upload allowlist (D-09, ASSET-01).
 *
 * Free-standing namespaced function (NOT a class method) because it is
 * registered as a filter callback via add_filter() with a string callable
 * (07-RESEARCH.md Pattern 1). The IANA-registered MIME for binary glTF is
 * `model/gltf-binary` — a similarly-named but non-IANA-registered variant
 * (swapping "gltf" for "glb" in the type) appears in some community
 * examples; see 07-RESEARCH.md's IANA correction for the verified type.
 *
 * @param array<string,string> $mimes Existing extension => MIME map.
 * @return array<string,string>
 */
function khaveeai_allow_glb_vrm_mimes( array $mimes ): array {
	$mimes['glb'] = 'model/gltf-binary';
	$mimes['vrm'] = 'model/gltf-binary'; // VRM is a GLB-format container; no distinct IANA type exists.
	return $mimes;
}

/**
 * Re-validate a .glb/.vrm upload's actual binary content against the GLB/VRM
 * magic-byte signature, independent of what khaveeai_allow_glb_vrm_mimes()
 * permitted by extension alone (ASSET-01 — the extension allowlist alone is
 * NOT sufficient; T-07C-01/T-07C-02).
 *
 * Free-standing namespaced function (NOT a class method) — registered as the
 * `wp_check_filetype_and_ext` filter callback (priority 10, 5 args) per
 * 07-RESEARCH.md Pattern 1.
 *
 * GLB/VRM 12-byte header: 4-byte magic ASCII "glTF" (0x67 0x6C 0x54 0x46),
 * then a 4-byte version (uint32 LE), then a 4-byte total length (uint32 LE).
 * Only the first 4 bytes are checked here.
 *
 * Fails CLOSED, not open: an unreadable file (fopen failure) is rejected,
 * never assumed valid.
 *
 * @param array|false $data      WP's current filetype/ext/proper_filename result.
 * @param string      $file      Absolute path to the uploaded file on disk.
 * @param string      $filename  The original (client-supplied) filename.
 * @param array       $mimes     The allowed mimes map in effect.
 * @param string|false $real_mime The MIME WP's own finfo-based sniff produced.
 * @return array|false
 */
function khaveeai_validate_glb_vrm_content( $data, $file, $filename, $mimes, $real_mime ) {
	$ext = strtolower( (string) pathinfo( $filename, PATHINFO_EXTENSION ) );

	if ( 'glb' !== $ext && 'vrm' !== $ext ) {
		return $data; // Not our file type — don't touch unrelated uploads (e.g. the standard Media Library's own png/jpg uploads).
	}

	$handle = @fopen( $file, 'rb' );
	if ( false === $handle ) {
		// Can't read it — reject, don't assume (fail-closed).
		$data['ext']  = false;
		$data['type'] = false;
		return $data;
	}

	$header = fread( $handle, 4 );
	fclose( $handle );

	if ( 'glTF' !== $header ) {
		// Wrong magic bytes — reject regardless of what the extension claimed.
		// This is the ASSET-01 disguised-file-upload mitigation (T-07C-01/T-07C-02).
		$data['ext']  = false;
		$data['type'] = false;
		return $data;
	}

	$data['ext']  = $ext;
	$data['type'] = 'model/gltf-binary';
	return $data;
}

/**
 * WP Settings API page: top-level menu, register_setting/add_settings_section/
 * add_settings_field, sanitize callbacks (masked-resave for api_key per
 * D-05/D-07/D-08), render callback with defense-in-depth capability check +
 * is_configured() "not configured" banner (D-14).
 */
final class SettingsPage {

	/**
	 * Settings option-group name passed to register_setting()/settings_fields().
	 *
	 * @var string
	 */
	private const OPTION_GROUP = 'khaveeai_settings_group';

	/**
	 * Option name the settings blob is stored under.
	 *
	 * Matches WpOptionsConfigSource::OPTION_NAME exactly.
	 *
	 * @var string
	 */
	private const OPTION_NAME = 'khaveeai_settings';

	/**
	 * The settings page slug (admin.php?page=<slug>).
	 *
	 * @var string
	 */
	private const PAGE_SLUG = 'khaveeai-settings';

	/**
	 * Hardcoded OpenAI Realtime voice enum (D-04 — no live fetch, no preview).
	 *
	 * Source of truth: packages/core/src/types/realtime.ts voice union.
	 *
	 * @var string[]
	 */
	private const VOICES = [
		'alloy',
		'ash',
		'ballad',
		'coral',
		'echo',
		'sage',
		'shimmer',
		'verse',
		'marin',
		'cedar',
	];

	/**
	 * Max avatar upload size in bytes: 50MB (D-10), enforced at the plugin
	 * level rather than deferred to host php.ini/upload_max_filesize defaults.
	 *
	 * @var int
	 */
	private const MAX_AVATAR_BYTES = 52428800;

	/**
	 * Nonce action name for the avatar-upload-filter activation gate (CR-02).
	 * Issued by render_avatar_field() via wp_create_nonce() and attached to
	 * the wp.media frame's upload params; verified in is_khaveeai_upload_request()
	 * via wp_verify_nonce(). Not a capability check by itself (the request is
	 * already manage_options-gated and carries WordPress core's own upload
	 * nonce) — this is the trust boundary for "the .glb/.vrm content-validation
	 * filters are active", replacing the spoofable Referer-only condition.
	 *
	 * @var string
	 */
	private const AVATAR_UPLOAD_NONCE_ACTION = 'khaveeai_avatar_upload';

	/**
	 * Request field name the avatar-upload nonce travels under (CR-02):
	 * "khaveeai_avatar_nonce". wp.media's uploader attaches this as an extra
	 * multipart param (see render_avatar_field()'s inline JS) so it rides
	 * along with the async-upload.php/admin-ajax.php upload POST, and
	 * is_khaveeai_upload_request() reads it back via $_REQUEST. Referenced
	 * everywhere as self::AVATAR_UPLOAD_NONCE_FIELD rather than the literal
	 * string, matching this file's existing self::PAGE_SLUG/self::OPTION_NAME
	 * single-source-of-truth convention.
	 *
	 * @var string
	 */
	private const AVATAR_UPLOAD_NONCE_FIELD = 'khaveeai_avatar_nonce';

	/**
	 * The shared ConfigSourceInterface (is_configured() + get_api_key()
	 * consumed in sanitize/render). Constructor-injected — never construct a
	 * concrete WpOptionsConfigSource here; Plugin.php owns that.
	 *
	 * @var ConfigSourceInterface
	 */
	private $config_source;

	/**
	 * The already-computed PlatformClient::fetch_preview() result for the
	 * currently-configured platform key, captured once in render_page() so
	 * the field renderers (render_instructions_field()/render_voice_field()/
	 * render_avatar_field()) can reach it without a second live fetch.
	 * Remains null when no platform key is configured (the "not synced,
	 * render exactly as today" branch in each renderer).
	 *
	 * Shape when non-null: array{ok: bool, project_name: string, fields: array, error: string}
	 * (see PlatformClient::fetch_preview()).
	 *
	 * @var array|null
	 */
	private $platform_preview = null;

	/**
	 * The hook suffix add_menu_page() returns for THIS settings page
	 * (quick task 260706-vf4). Captured so enqueue_settings_assets() can
	 * scope the `khaveeai-preview` bundle + wp-color-picker to ONLY this
	 * admin screen — comparing against a hardcoded
	 * 'toplevel_page_khaveeai-settings' string would be fragile if the menu
	 * registration ever changes; the return value is the robust source of
	 * truth WordPress itself uses for the same purpose (e.g. load-<hook>
	 * hooks).
	 *
	 * @var string|null
	 */
	private $hook_suffix = null;

	/**
	 * @param ConfigSourceInterface $config_source Shared with SessionController
	 *                                             (Plugin.php wires the same instance).
	 */
	public function __construct( ConfigSourceInterface $config_source ) {
		$this->config_source = $config_source;
	}

	// ── Hook registration ──────────────────────────────────────────────

	/**
	 * Register the admin_menu + admin_init hooks. Called once from
	 * Plugin::boot(); this method itself calls add_action(), so the caller
	 * must NOT wrap register_hooks() in another add_action() call.
	 *
	 * @return void
	 */
	public function register_hooks(): void {
		add_action( 'admin_menu', array( $this, 'add_menu_page' ) );
		add_action( 'admin_init', array( $this, 'register_settings' ) );
		add_action( 'admin_init', array( $this, 'maybe_register_avatar_upload_filters' ) );
		// Quick task 260706-vf4: page-scoped preview bundle + color-picker
		// enqueue for the Floating Widget live preview. admin_enqueue_scripts
		// fires on EVERY admin page; enqueue_settings_assets() early-returns
		// unless $hook_suffix matches $this->hook_suffix (set in add_menu_page()).
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_settings_assets' ) );
	}

	// ── Menu + settings registration ───────────────────────────────────

	/**
	 * Register the top-level wp-admin menu item (D-02). The `manage_options`
	 * capability arg is the FIRST layer of the SET-05 defense-in-depth gate;
	 * render_page() re-checks it independently (Pitfall 3 — menu capability
	 * only hides the link, does not block direct URL navigation).
	 *
	 * @return void
	 */
	public function add_menu_page(): void {
		// Quick task 260706-vf4: capture the hook suffix so
		// enqueue_settings_assets() can scope asset loading to THIS page only.
		$this->hook_suffix = add_menu_page(
			__( 'Khavee AI Avatar', 'khaveeai' ),
			__( 'Khavee AI Avatar', 'khaveeai' ),
			'manage_options', // D-02/SET-05: capability gate at registration.
			self::PAGE_SLUG,
			array( $this, 'render_page' ),
			'dashicons-microphone'
		);
	}

	/**
	 * Page-scoped enqueue for the Floating Widget live preview (quick task
	 * 260706-vf4): a SECOND consumer of the `khaveeai-preview` bundle already
	 * registered by Plugin::register_preview_bundle() (init:9) for the block
	 * editor. Loads it (+ WP core's color picker) ONLY on THIS admin page —
	 * scoped via $this->hook_suffix (captured in add_menu_page()) so the
	 * 400KB+ bundle never loads on any other wp-admin screen.
	 *
	 * Does not modify Plugin::register_preview_bundle(), the
	 * enqueue_block_editor_assets hook, preview.ts, build.mjs, or the
	 * STUDIO-02 safety grep assertion — those stay exactly as they are.
	 *
	 * @param string $hook_suffix The current admin page's hook suffix, passed
	 *                            in by the admin_enqueue_scripts action.
	 * @return void
	 */
	public function enqueue_settings_assets( $hook_suffix ): void {
		if ( $hook_suffix !== $this->hook_suffix ) {
			return; // Not the Khavee settings page — never load the bundle elsewhere.
		}

		wp_enqueue_script( 'khaveeai-preview' );
		wp_enqueue_style( 'khaveeai-preview-style' );

		// WP core handles — no new dependency.
		wp_enqueue_script( 'wp-color-picker' );
		wp_enqueue_style( 'wp-color-picker' );

		// Attached to the 'wp-color-picker' handle (not a standalone inline
		// script) so its jQuery dependency is guaranteed already defined when
		// this runs. Plain vanilla JS + jQuery-for-wpColorPicker only — no
		// build step, no new file, so it stays out of the release-zip
		// packaging problem (only build/ and vendor/ are guaranteed
		// packaged). Rewrites the mount div's data-khaveeai-preview-config
		// attribute on every change to the five floating fields; the
		// khaveeai-preview bundle's own MutationObserver
		// (mountPreview.tsx PreviewHost) re-renders instantly with no page
		// reload and no WebGL context teardown.
		$js = <<<'JS'
jQuery( function ( $ ) {
	var mount = document.getElementById( 'khaveeai-floating-preview' );
	if ( ! mount ) {
		return;
	}

	// Read the resolved avatarUrl ONCE from the mount div's initial config
	// (PHP-rendered) so rebuild() never blanks the avatar — none of the
	// five editable fields carry avatarUrl.
	var initialAvatarUrl = '';
	try {
		var initialConfig = JSON.parse( mount.dataset.khaveeaiPreviewConfig || '{}' );
		initialAvatarUrl = initialConfig.avatarUrl || '';
	} catch ( e ) {
		initialAvatarUrl = '';
	}

	// colorOverride lets the irischange handler below pass the color Iris
	// just computed (event.ui.color) directly, bypassing colorEl.value —
	// confirmed live that a palette-swatch click fires `irischange` BEFORE
	// Iris writes the new color into the input's DOM value (el.value inside
	// the handler still holds the PREVIOUS click's color, one step behind),
	// while event.ui.color already carries the correct, current color at
	// fire time. Reading colorEl.value here would silently rebuild the
	// preview one click stale on every palette-swatch interaction.
	function rebuild( colorOverride ) {
		var colorEl       = document.getElementById( 'khaveeai_floating_bg_color' );
		var transparentEl = document.getElementById( 'khaveeai_floating_bg_transparent' );
		var offsetXEl     = document.getElementById( 'khaveeai_floating_avatar_offset_x' );
		var offsetYEl     = document.getElementById( 'khaveeai_floating_avatar_offset_y' );
		var scaleEl       = document.getElementById( 'khaveeai_floating_avatar_scale' );
		var rotEl         = document.getElementById( 'khaveeai_floating_camera_rotation_y' );

		var cfg = {
			avatarUrl: initialAvatarUrl,
			bgType: 'color',
			bgColor: colorOverride || ( colorEl ? colorEl.value : '#6929ff' ),
			bgTransparent: transparentEl ? transparentEl.checked : false,
			avatarScale: scaleEl ? parseFloat( scaleEl.value ) : 1.0,
			avatarOffsetX: offsetXEl ? parseFloat( offsetXEl.value ) : 0.0,
			avatarOffsetY: offsetYEl ? parseFloat( offsetYEl.value ) : 0.0,
			cameraRotationY: rotEl ? parseFloat( rotEl.value ) : 0.0
		};

		mount.dataset.khaveeaiPreviewConfig = JSON.stringify( cfg );

		var offsetXOut = document.getElementById( 'khaveeai_floating_avatar_offset_x_out' );
		if ( offsetXOut && offsetXEl ) {
			offsetXOut.textContent = offsetXEl.value;
		}
		var offsetYOut = document.getElementById( 'khaveeai_floating_avatar_offset_y_out' );
		if ( offsetYOut && offsetYEl ) {
			offsetYOut.textContent = offsetYEl.value;
		}
		var scaleOut = document.getElementById( 'khaveeai_floating_avatar_scale_out' );
		if ( scaleOut && scaleEl ) {
			scaleOut.textContent = scaleEl.value;
		}
		var rotOut = document.getElementById( 'khaveeai_floating_camera_rotation_y_out' );
		if ( rotOut && rotEl ) {
			rotOut.textContent = rotEl.value;
		}
	}

	// wpColorPicker's `change`/`clear` options both receive (event, ui) as
	// arguments — ui.color is present for `change`, absent for `clear` (the
	// field is blanked instead). Wrap rebuild() rather than pass it directly
	// so its optional colorOverride param never receives the raw jQuery
	// event object as a false-truthy value.
	$( '.khaveeai-color-field' ).wpColorPicker( {
		change: function ( event, ui ) {
			rebuild( ui && ui.color ? ui.color.toString() : null );
		},
		clear: function () {
			rebuild();
		}
	} );

	// wpColorPicker's own `change` option above is NOT invoked when a
	// discrete palette swatch is clicked inside the popup (confirmed live:
	// Iris's palette-click handler sets the input's value via jQuery .val()
	// without dispatching a native `input`/`change` DOM event, and without
	// routing through the wp-color-picker widget's own `_trigger`, so
	// neither that callback NOR the belt-and-braces listeners below fire for
	// that one interaction path — direct hex typing and the gradient/hue
	// drag both work correctly already). Iris's underlying `irischange`
	// jQuery custom event DOES fire for every interaction path including
	// palette clicks, so bind rebuild() to it directly as the reliable
	// catch-all — passing event.ui.color explicitly, since confirmed live
	// that `irischange` fires BEFORE Iris writes the new color into the
	// input's DOM value (colorEl.value inside rebuild() would read the
	// PREVIOUS click's color, one step behind, without this override).
	$( '.khaveeai-color-field' ).on( 'irischange', function ( event, ui ) {
		rebuild( ui && ui.color ? ui.color.toString() : null );
	} );

	// Belt-and-braces: plain input/change listeners on all five fields so
	// every keystroke / slider drag / checkbox toggle calls rebuild(), even
	// if wpColorPicker's own callback ever misses an edit path.
	var ids = [
		'khaveeai_floating_bg_color',
		'khaveeai_floating_bg_transparent',
		'khaveeai_floating_avatar_offset_x',
		'khaveeai_floating_avatar_offset_y',
		'khaveeai_floating_avatar_scale',
		'khaveeai_floating_camera_rotation_y'
	];
	ids.forEach( function ( id ) {
		var el = document.getElementById( id );
		if ( ! el ) {
			return;
		}
		el.addEventListener( 'input', rebuild );
		el.addEventListener( 'change', rebuild );
	} );

	// Quick task 260706-wop: closes the drag-orbit loop. The khaveeai-preview
	// bundle's mountPreview.tsx dispatches this CustomEvent on the mount div
	// once per drag/zoom release on the preview's OrbitControls (PreviewScene.tsx
	// onEnd -> angleFromCameraPosition). Write the read-back angle into the
	// slider + its readout, then rebuild() — which writes the SAME angle back
	// into the preview config, so CameraController re-applies the angle it was
	// just read from (no oscillation: onEnd only fires on user interaction,
	// never on this programmatic reset).
	mount.addEventListener( 'khaveeai-preview-camera-angle', function ( e ) {
		var d = Math.round( e.detail.deg );
		var el = document.getElementById( 'khaveeai_floating_camera_rotation_y' );
		if ( el ) {
			el.value = d;
		}
		var out = document.getElementById( 'khaveeai_floating_camera_rotation_y_out' );
		if ( out ) {
			out.textContent = d;
		}
		rebuild();
	} );
} );
JS;

		wp_add_inline_script( 'wp-color-picker', $js, 'after' );
	}

	/**
	 * Register the avatar-upload filters under their CORRECT request-lifecycle
	 * conditions. 07-05 separates the two filters that 07-03/07-04 had ANDed
	 * behind a single gate, because they have DISTINCT lifecycle needs:
	 *
	 *  1. upload_mimes (T-07E-01, GET-render branch): widens Plupload's
	 *     CLIENT-SIDE extension allowlist. Plupload builds that list from
	 *     get_allowed_mime_types() ONCE at settings-page GET render time
	 *     (wp_plupload_default_settings(), WP core wp-includes/media.php),
	 *     so this filter MUST be active during the GET render for glb/vrm to
	 *     appear in the list. Gated on manage_options + page-match ONLY
	 *     (is_khaveeai_settings_page_render() / is_settings_page_render_allowed())
	 *     — widening upload_mimes does NOT bypass server-side content
	 *     validation, so a capability+page condition suffices here.
	 *
	 *  2. wp_check_filetype_and_ext (ASSET-01 magic-byte, POST branch) +
	 *     upload_size_limit: the server-side content validation and size cap.
	 *     STAY nonce-gated on the upload POST via is_khaveeai_upload_request()
	 *     (CR-02, 07-04 — UNCHANGED). A disguised file (correct extension,
	 *     wrong bytes) now passes Plupload client-side but is rejected
	 *     SERVER-SIDE here (T-07E-02).
	 *
	 * BOTH branches schedule their OWN shutdown cleanup via
	 * remove_avatar_upload_filters() so neither filter set leaks past the
	 * request — the standard Media Library "Add New" screen and every other
	 * upload path must continue to reject glb/vrm (T-07C-03/T-07E-03).
	 *
	 * History: 07-03 resolved Open Question 2 / A2 by replacing the
	 * empirically-falsified load-<hook_suffix> mechanism with admin_init +
	 * an HTTP Referer check (load-<hook_suffix> never fires on
	 * async-upload.php/admin-ajax.php — confirmed live in the 07-03 Task 3
	 * checkpoint). 07-04 hardened that with a nonce AND-clause (CR-02).
	 * 07-05 keeps admin_init + Referer + nonce + shutdown-cleanup intact
	 * for the POST branch and adds the GET-render branch for upload_mimes;
	 * load-<hook_suffix> is NOT reintroduced (07-03-SUMMARY.md Deviation 2).
	 *
	 * @return void
	 */
	public function maybe_register_avatar_upload_filters(): void {
		// ── GET-render branch (T-07E-01): widen Plupload's CLIENT-SIDE
		// extension allowlist at the moment wp_plupload_default_settings()
		// builds _wpPluploadSettings from get_allowed_mime_types() during the
		// settings-page GET render. Without this branch, Plupload rejects
		// every .glb/.vrm selection client-side with "This file cannot be
		// processed by the web server." BEFORE any upload POST fires — see
		// .planning/debug/avatar-upload-rejected.md for the live wp-env proof.
		//
		// This branch registers ONLY upload_mimes. It does NOT register the
		// magic-byte wp_check_filetype_and_ext filter — that filter stays
		// nonce-gated on the POST branch below (CR-02/ASSET-01, unchanged):
		// widening Plupload's client-side extension list does NOT bypass the
		// server-side content validation, because the nonce-gated
		// khaveeai_validate_glb_vrm_content() still rejects a disguised file
		// (correct extension, wrong bytes) when the upload POST arrives. This
		// is the clean separation the diagnosis prescribes (T-07E-02).
		//
		// The widening itself is capability-gated (manage_options AND
		// page-match) and schedules its OWN shutdown cleanup so the global
		// upload_mimes list does not leak glb/vrm to any other screen/
		// lifecycle (T-07E-03 — the standard Media Library "Add New" screen
		// and every other upload path must continue to reject glb/vrm).
		if ( $this->is_khaveeai_settings_page_render() ) {
			add_filter( 'upload_mimes', __NAMESPACE__ . '\\khaveeai_allow_glb_vrm_mimes' );
			add_action( 'shutdown', array( $this, 'remove_avatar_upload_filters' ) );
		}

		// ── POST branch (CR-02, UNCHANGED from 07-04): the nonce-gated
		// server-side ASSET-01 content validation. Activates ONLY on the
		// actual upload POST (async-upload.php/admin-ajax.php) when the
		// plugin-issued nonce verifies — a forged Referer alone can no longer
		// activate these filters. load-<hook_suffix> is NOT reintroduced
		// (07-03-SUMMARY.md Deviation 2 — empirically falsified live).
		if ( ! $this->is_khaveeai_upload_request() ) {
			return;
		}

		add_filter( 'wp_check_filetype_and_ext', __NAMESPACE__ . '\\khaveeai_validate_glb_vrm_content', 10, 5 );
		add_filter( 'upload_size_limit', array( $this, 'limit_avatar_upload_size' ) );

		add_action( 'shutdown', array( $this, 'remove_avatar_upload_filters' ) );
	}

	/**
	 * True when the current request either renders the khaveeai settings
	 * page directly (`page` query var) or originates from it via the
	 * browser's Referer header (the `wp.media` Upload-tab AJAX path —
	 * `admin-ajax.php`/`async-upload.php` — never carries the `page` query
	 * var itself, only the Referer of the tab/page that opened the frame)
	 * AND a verifiable plugin-issued nonce is present on the request (CR-02).
	 *
	 * The Referer/page condition alone is spoofable by a non-browser HTTP
	 * client or a forged Referer header — it is no longer the sole trust
	 * boundary deciding whether the .glb/.vrm content-validation filters
	 * activate. Read the nonce from $_REQUEST (wp.media's uploader attaches
	 * it as an extra multipart param, so it travels with the actual upload
	 * POST regardless of whether that POST hits async-upload.php or
	 * admin-ajax.php) and fail CLOSED — same fail-closed posture as
	 * khaveeai_validate_glb_vrm_content() — on a missing, non-string, empty,
	 * or invalid nonce, even when the page/Referer condition is satisfied.
	 *
	 * The admin_init + Referer + shutdown-cleanup mechanism itself (07-03's
	 * shipped, live-verified fix) is UNCHANGED here — only this predicate
	 * gains the nonce AND-clause. load-<hook_suffix> is NOT reintroduced
	 * (07-03-SUMMARY.md Deviation 2 — that mechanism never fires on
	 * async-upload.php/admin-ajax.php, confirmed empirically).
	 *
	 * @return bool
	 */
	private function is_khaveeai_upload_request(): bool {
		$page_or_referer_match = false;

		if ( isset( $_GET['page'] ) && self::PAGE_SLUG === $_GET['page'] ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			$page_or_referer_match = true;
		} else {
			$referer = wp_get_referer();
			if ( is_string( $referer ) && '' !== $referer ) {
				$query = (string) wp_parse_url( $referer, PHP_URL_QUERY );
				wp_parse_str( $query, $referer_args );
				$page_or_referer_match = isset( $referer_args['page'] ) && self::PAGE_SLUG === $referer_args['page'];
			}
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- verified explicitly below via wp_verify_nonce(), not the WP_CLI/REST nonce convention this rule expects.
		$nonce = $_REQUEST[ self::AVATAR_UPLOAD_NONCE_FIELD ] ?? '';

		return self::is_upload_request_allowed( $page_or_referer_match, $nonce );
	}

	/**
	 * Runtime reader for the GET-render upload_mimes widening condition
	 * (T-07E-01): true when the current user has manage_options AND the
	 * `page` query var is this settings page's slug. Delegates the actual
	 * decision to the pure is_settings_page_render_allowed() helper so the
	 * bare-PHP harness can exercise the fail-closed capability/page logic
	 * without reading WP superglobals or constructing a SettingsPage instance
	 * — mirrors 07-04's is_upload_request_allowed() extraction pattern.
	 *
	 * Why this is a SEPARATE condition from is_khaveeai_upload_request()
	 * (CR-02, unchanged): Plupload (wp.media's client-side uploader) builds
	 * its extension allowlist from get_allowed_mime_types() ONCE at
	 * settings-page GET render time (wp_plupload_default_settings(), WP core
	 * wp-includes/media.php). For glb/vrm to appear in that list, the
	 * upload_mimes filter must be active DURING the GET render. But a GET
	 * render never carries the khaveeai_avatar_nonce (the nonce is emitted
	 * INTO the page via wp_create_nonce(), not sent TO the page as a request
	 * parameter) — so is_khaveeai_upload_request() (which requires the nonce)
	 * structurally returns false on every GET render, the upload_mimes filter
	 * never registered, and Plupload rejected every .glb/.vrm client-side
	 * with "This file cannot be processed by the web server." before any
	 * upload POST fired. Proven live against wp-env — see
	 * .planning/debug/avatar-upload-rejected.md.
	 *
	 * Security: this widening is SAFE because upload_mimes does NOT bypass
	 * wp_check_filetype_and_ext. A disguised file (correct extension, wrong
	 * bytes) now passes Plupload client-side but is rejected SERVER-SIDE by
	 * the nonce-gated khaveeai_validate_glb_vrm_content() on the upload POST
	 * (CR-02/ASSET-01, unchanged). The capability gate (manage_options)
	 * matches the menu/render_page() gate — only admins ever reach this GET
	 * render — and the page-match check ensures the widening does not apply
	 * to any other admin screen. (KHAVEEAI-UAT-5, T-07E-01/T-07E-02/T-07E-03)
	 *
	 * @return bool
	 */
	private function is_khaveeai_settings_page_render(): bool {
		$can_manage_options = current_user_can( 'manage_options' );
		$page_query_var     = isset( $_GET['page'] ) ? (string) $_GET['page'] : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- this is a render-condition read, not a nonce check; the nonce gate is the separate is_khaveeai_upload_request() branch for the POST.

		return self::is_settings_page_render_allowed( $can_manage_options, $page_query_var );
	}

	/**
	 * Pure decision predicate for the GET-render upload_mimes widening
	 * (T-07E-01): true ONLY when $can_manage_options is true AND
	 * $page_query_var equals self::PAGE_SLUG.
	 *
	 * Extracted as a public static pure function (mirrors mask_api_key()/
	 * sanitize_avatar_attachment_id()/is_upload_request_allowed()'s
	 * static-for-testability pattern) so the bare-PHP harness can exercise
	 * the fail-closed capability/page logic without WP superglobals.
	 * is_khaveeai_settings_page_render() is the only caller that reads
	 * current_user_can()/$_GET — this method is otherwise pure.
	 *
	 * @param bool   $can_manage_options Whether current_user_can('manage_options') passed.
	 * @param string $page_query_var     The raw `page` query var (empty when absent).
	 * @return bool
	 */
	public static function is_settings_page_render_allowed( bool $can_manage_options, string $page_query_var ): bool {
		if ( ! $can_manage_options ) {
			return false; // Non-admin GET never widens the Plupload allowlist.
		}

		return self::PAGE_SLUG === $page_query_var;
	}

	/**
	 * Pure decision predicate for the avatar-upload-filter activation gate
	 * (CR-02): true only when BOTH the page/Referer condition is satisfied
	 * AND $nonce verifies against the AVATAR_UPLOAD_NONCE_ACTION action.
	 *
	 * Extracted as a public static pure function (mirrors mask_api_key()/
	 * sanitize_avatar_attachment_id()'s static-for-testability pattern) so
	 * the bare-PHP harness can exercise the fail-closed logic without
	 * reading WP superglobals or constructing a SettingsPage instance.
	 * is_khaveeai_upload_request() is the only caller that reads
	 * $_GET/$_REQUEST/wp_get_referer() — this method is otherwise pure.
	 *
	 * @param bool  $page_or_referer_match Whether the existing page-query-var
	 *                                     OR Referer condition was satisfied.
	 * @param mixed $nonce                 The raw nonce value read from the
	 *                                     request (any type — non-string
	 *                                     input fails closed).
	 * @return bool
	 */
	public static function is_upload_request_allowed( bool $page_or_referer_match, $nonce ): bool {
		if ( ! $page_or_referer_match ) {
			return false;
		}

		if ( ! is_string( $nonce ) || '' === $nonce ) {
			return false; // Fail closed: missing/non-string nonce never activates the filters.
		}

		return (bool) wp_verify_nonce( $nonce, self::AVATAR_UPLOAD_NONCE_ACTION );
	}

	/**
	 * Remove the avatar upload content-validation filters at the end of the
	 * request (Pitfall 4, T-07C-03) — the standard Media Library "Add New"
	 * screen and every other upload path/request on the site must continue
	 * to reject .glb/.vrm. Hooked onto `shutdown` (not `admin_footer`,
	 * which never fires for the `admin-ajax.php`/`async-upload.php` AJAX
	 * requests this filter registration now also covers).
	 *
	 * @return void
	 */
	public function remove_avatar_upload_filters(): void {
		remove_filter( 'upload_mimes', __NAMESPACE__ . '\\khaveeai_allow_glb_vrm_mimes' );
		remove_filter( 'wp_check_filetype_and_ext', __NAMESPACE__ . '\\khaveeai_validate_glb_vrm_content', 10 );
		remove_filter( 'upload_size_limit', array( $this, 'limit_avatar_upload_size' ) );
	}

	/**
	 * upload_size_limit filter callback: caps the avatar upload at 50MB
	 * (D-10) while this screen's filters are registered, without lowering
	 * the limit below what the host php.ini already allows.
	 *
	 * @param int $bytes Current upload size limit in bytes.
	 * @return int
	 */
	public function limit_avatar_upload_size( $bytes ): int {
		return min( (int) $bytes, self::MAX_AVATAR_BYTES );
	}

	/**
	 * Register the setting, its main section, and the non-avatar fields.
	 * The avatar field is added by 07-03 (see the marked insertion point below).
	 *
	 * @return void
	 */
	public function register_settings(): void {
		register_setting(
			self::OPTION_GROUP,
			self::OPTION_NAME,
			array( 'sanitize_callback' => array( $this, 'sanitize_settings' ) )
		);

		add_settings_section(
			'khaveeai_main',
			__( 'Khavee AI Avatar Settings', 'khaveeai' ),
			array( $this, 'render_main_section_intro' ),
			self::PAGE_SLUG
		);

		add_settings_field(
			'api_key',
			__( 'OpenAI API Key', 'khaveeai' ),
			array( $this, 'render_api_key_field' ),
			self::PAGE_SLUG,
			'khaveeai_main'
		);

		// Quick-260703-slv: a second, separate secret — the Khavee Platform
		// API key — masked/removable exactly like the OpenAI key above, but
		// gated on a `khavee_` prefix instead of `sk-` (T-QK-01/T-QK-05).
		add_settings_field(
			'platform_api_key',
			__( 'Khavee Platform API Key', 'khaveeai' ),
			array( $this, 'render_platform_api_key_field' ),
			self::PAGE_SLUG,
			'khaveeai_main'
		);

		add_settings_field(
			'instructions',
			__( 'Personality / Instructions', 'khaveeai' ),
			array( $this, 'render_instructions_field' ),
			self::PAGE_SLUG,
			'khaveeai_main'
		);

		add_settings_field(
			'voice',
			__( 'Voice', 'khaveeai' ),
			array( $this, 'render_voice_field' ),
			self::PAGE_SLUG,
			'khaveeai_main'
		);

		add_settings_field(
			'avatar',
			__( 'Avatar (VRM/GLB)', 'khaveeai' ),
			array( $this, 'render_avatar_field' ),
			self::PAGE_SLUG,
			'khaveeai_main'
		);

		// FLOAT-01 (quick task 260704-77n): registered here for Settings API
		// consistency (do_settings_sections() callers, WP-CLI introspection,
		// etc.) even though render_page()'s manual sectioned layout below is
		// what actually renders the field on this page.
		add_settings_field(
			'floating_widget_enabled',
			__( 'Enable floating widget', 'khaveeai' ),
			array( $this, 'render_floating_widget_field' ),
			self::PAGE_SLUG,
			'khaveeai_main'
		);

		// Quick task 260705-p30: floating-widget-only visual config, mirroring
		// the floating_widget_enabled registration shape exactly.
		add_settings_field(
			'floating_bg_color',
			__( 'Floating background color', 'khaveeai' ),
			array( $this, 'render_floating_bg_color_field' ),
			self::PAGE_SLUG,
			'khaveeai_main'
		);

		add_settings_field(
			'floating_bg_transparent',
			__( 'Transparent floating background', 'khaveeai' ),
			array( $this, 'render_floating_bg_transparent_field' ),
			self::PAGE_SLUG,
			'khaveeai_main'
		);

		add_settings_field(
			'floating_avatar_offset_x',
			__( 'Floating avatar offset X', 'khaveeai' ),
			array( $this, 'render_floating_avatar_offset_x_field' ),
			self::PAGE_SLUG,
			'khaveeai_main'
		);

		add_settings_field(
			'floating_avatar_offset_y',
			__( 'Floating avatar offset Y', 'khaveeai' ),
			array( $this, 'render_floating_avatar_offset_y_field' ),
			self::PAGE_SLUG,
			'khaveeai_main'
		);

		add_settings_field(
			'floating_avatar_scale',
			__( 'Floating avatar scale', 'khaveeai' ),
			array( $this, 'render_floating_avatar_scale_field' ),
			self::PAGE_SLUG,
			'khaveeai_main'
		);

		add_settings_field(
			'floating_camera_rotation_y',
			__( 'Floating camera angle', 'khaveeai' ),
			array( $this, 'render_floating_camera_rotation_y_field' ),
			self::PAGE_SLUG,
			'khaveeai_main'
		);
	}

	// ── Sanitize orchestrator + key sanitize logic ─────────────────────

	/**
	 * Settings API sanitize_callback for the whole khaveeai_settings option.
	 *
	 * Orchestrates per-field sanitization. Reads the existing stored option
	 * for the non-key fields (so an absent field on a partial POST preserves
	 * prior values), resolves the existing api_key via the injected
	 * ConfigSourceInterface, and returns the merged sanitized array.
	 * Blank-field-and-save is the key-removal signal (Quick-260707-0u6 item 2)
	 * — there is no separate remove-key checkbox flag to interpret anymore.
	 * NEVER calls update_option() directly — register_setting()'s returned
	 * sanitize_callback value is what WordPress persists.
	 *
	 * `model` is deliberately NOT written here (D-03) — it remains at
	 * WpOptionsConfigSource::DEFAULT_MODEL, untouched by this page.
	 *
	 * Avatar fields (07-03, SET-04): reads the existing avatar_attachment_id,
	 * applies sanitize_avatar_attachment_id() to the submitted value, then
	 * honors the "Clear avatar" checkbox by forcing 0 regardless of what was
	 * submitted for the attachment ID (D-06-style deliberate removal, mirrors
	 * the API-key Remove pattern). The transient remove_avatar checkbox value
	 * itself is consumed here, not persisted into the stored option array.
	 *
	 * @param array $input Raw submitted option array from options.php.
	 * @return array
	 */
	public function sanitize_settings( array $input ): array {
		$existing_option = get_option( self::OPTION_NAME, array() );
		if ( ! is_array( $existing_option ) ) {
			$existing_option = array();
		}

		$existing_api_key    = $this->config_source->get_api_key();
		$submitted_api_key   = isset( $input['api_key'] ) ? (string) $input['api_key'] : '';
		$submitted_instr     = isset( $input['instructions'] ) ? (string) $input['instructions'] : '';
		$submitted_voice     = isset( $input['voice'] ) ? (string) $input['voice'] : '';

		// Quick-260703-slv: the platform key is unrelated to the OpenAI
		// api_key above — read its existing value from the raw stored option
		// blob (NOT via ConfigSourceInterface, which never exposes it), mirror
		// the same submitted-value decision order as the OpenAI key (D-05/D-08,
		// but the format gate is `khavee_` not `sk-`). Quick-260707-0u6 item 2:
		// blank-field-and-save is now the removal signal for both keys — the
		// separate remove_key/remove_platform_key checkboxes are gone.
		$existing_platform_key          = isset( $existing_option['platform_api_key'] ) ? (string) $existing_option['platform_api_key'] : '';
		$submitted_platform_key         = isset( $input['platform_api_key'] ) ? (string) $input['platform_api_key'] : '';

		$existing_attachment_id   = isset( $existing_option['avatar_attachment_id'] ) ? (int) $existing_option['avatar_attachment_id'] : 0;
		$submitted_attachment_id  = $input['avatar_attachment_id'] ?? '';
		$remove_avatar_requested  = isset( $input['remove_avatar'] ) && '1' === (string) $input['remove_avatar'];

		$sanitized = $existing_option; // Preserve any prior keys (model untouched per D-03).

		$sanitized['api_key']           = $this->sanitize_api_key( $submitted_api_key, $existing_api_key );
		$sanitized['platform_api_key']  = $this->sanitize_platform_api_key( $submitted_platform_key, $existing_platform_key );
		$sanitized['instructions']      = sanitize_textarea_field( $submitted_instr );

		// CR-01/SET-03: a submitted voice is persisted ONLY when it is one of
		// the self::VOICES allowlist values (strict in_array, third arg true,
		// so loose/non-string matches cannot sneak through). The <select>
		// dropdown already constrains a well-behaved browser submission, but
		// register_setting()'s sanitize_callback is the only real gate against
		// a crafted options.php POST — without this check an arbitrary string
		// would persist and later be forwarded unrevalidated into the trusted
		// OpenAI Realtime session config by SessionController. Rejected values
		// fall back to the existing stored voice — mirrors sanitize_api_key()'s
		// D-05 convention of never overwriting with a rejected submission.
		//
		// The fallback itself is re-validated against the same allowlist
		// (CR-01-NEW): an existing option value can be non-allowlisted if it
		// was written before this check existed, or via an out-of-band path
		// (WP-CLI, SQL import, backup restore). Falling back to an unvalidated
		// existing value would durably re-persist that poisoned data forever.
		$existing_voice = isset( $existing_option['voice'] ) && in_array( $existing_option['voice'], self::VOICES, true )
			? $existing_option['voice']
			: self::VOICES[0];

		$sanitized['voice'] = in_array( $submitted_voice, self::VOICES, true )
			? sanitize_text_field( $submitted_voice )
			: $existing_voice;

		if ( $remove_avatar_requested ) {
			// D-06-style deliberate removal: the "Clear avatar" checkbox forces 0
			// regardless of whatever attachment ID was submitted alongside it.
			$sanitized['avatar_attachment_id'] = 0;
		} else {
			$sanitized['avatar_attachment_id'] = self::sanitize_avatar_attachment_id( $submitted_attachment_id, $existing_attachment_id );
		}

		// FLOAT-01 (quick task 260704-77n, T-77n-02): strict boolean coercion —
		// isset() + '1'===(string) cast, matching the checkbox read shape used
		// by remove_avatar above. Unlike that transient remove_avatar flag,
		// this one IS persisted (it's a durable on/off setting, not a
		// one-shot deletion trigger).
		$sanitized['floating_widget_enabled'] = isset( $input['floating_widget_enabled'] ) && '1' === (string) $input['floating_widget_enabled'];

		// Quick task 260705-p30: floating-widget-only visual config —
		// same strict boolean-coercion / isset->cast->fallback shapes used
		// throughout this method.
		$sanitized['floating_bg_color']        = isset( $input['floating_bg_color'] ) ? sanitize_text_field( (string) $input['floating_bg_color'] ) : '';
		$sanitized['floating_bg_transparent']  = isset( $input['floating_bg_transparent'] ) && '1' === (string) $input['floating_bg_transparent'];
		$sanitized['floating_avatar_offset_x'] = isset( $input['floating_avatar_offset_x'] ) ? (float) $input['floating_avatar_offset_x'] : 0.0;
		$sanitized['floating_avatar_offset_y'] = isset( $input['floating_avatar_offset_y'] ) ? (float) $input['floating_avatar_offset_y'] : 0.0;
		$sanitized['floating_avatar_scale']    = isset( $input['floating_avatar_scale'] ) ? (float) $input['floating_avatar_scale'] : 1.0;
		$sanitized['floating_camera_rotation_y'] = isset( $input['floating_camera_rotation_y'] ) ? (float) $input['floating_camera_rotation_y'] : 0.0;

		return $sanitized;
	}

	/**
	 * Mask an API key for redisplay in the form field's value attribute.
	 *
	 * Format (D-07): literal `sk-••••••` prefix + last 4 characters of the key.
	 * Returns '' for empty input so an unconfigured key renders an empty field
	 * rather than a bare `sk-••••••` placeholder that could mislead the admin.
	 *
	 * Static so the test harness can exercise it without constructing a
	 * SettingsPage instance (mirrors OpenAiDirectTokenProvider::mint_session's
	 * parameter-based testability per 07-PATTERNS.md).
	 *
	 * @param string $key The raw stored API key.
	 * @return string The masked string, or '' if $key is empty.
	 */
	public static function mask_api_key( string $key ): string {
		if ( '' === $key ) {
			return '';
		}
		return 'sk-••••••' . substr( $key, -4 ); // D-07: literal SET-01 example format.
	}

	/**
	 * Mask a Khavee Platform API key for redisplay in the form field's value
	 * attribute (Quick-260703-slv, T-QK-01).
	 *
	 * Format: literal `khavee_••••••` prefix + last 4 characters of the key
	 * — mirrors mask_api_key()'s D-07 format exactly, but for the
	 * `khavee_<uuid>_<64hex>` platform key instead of the `sk-` OpenAI key.
	 * Returns '' for empty input so an unconfigured key renders an empty
	 * field rather than a bare `khavee_••••••` placeholder (never echo the
	 * raw key — T-07B-03 discipline).
	 *
	 * Static so the test harness can exercise it without constructing a
	 * SettingsPage instance (mirrors mask_api_key()'s testability decision).
	 *
	 * @param string $key The raw stored platform API key.
	 * @return string The masked string, or '' if $key is empty.
	 */
	public static function mask_platform_key( string $key ): string {
		if ( '' === $key ) {
			return '';
		}
		return 'khavee_••••••' . substr( $key, -4 );
	}

	/**
	 * Sanitize a submitted avatar_attachment_id value (T-07C-06).
	 *
	 * Static, mirroring mask_api_key()'s testability decision — the harness
	 * calls this without constructing a SettingsPage instance.
	 *
	 * Uses filter_var()/FILTER_VALIDATE_INT rather than a bare (int) cast so
	 * non-numeric garbage ("not-a-number", an array, etc.) cannot silently
	 * coerce to 0 and be confused with a deliberate-removal "0" submission —
	 * filter_var() returns false on non-numeric input, which this method
	 * maps to "preserve existing", not "remove".
	 *
	 * @param mixed $submitted The raw submitted attachment ID value.
	 * @param int   $existing  The currently-stored attachment ID.
	 * @return int The sanitized attachment ID: a positive int, 0 (deliberate
	 *             removal via "0"/empty submission), or $existing unchanged
	 *             when $submitted is non-numeric garbage.
	 */
	public static function sanitize_avatar_attachment_id( $submitted, int $existing ): int {
		if ( '' === $submitted || null === $submitted ) {
			return 0; // Empty submission — treated as removal, matching the "0" case below.
		}

		$validated = filter_var( $submitted, FILTER_VALIDATE_INT );

		if ( false === $validated ) {
			// Non-numeric garbage never overwrites the existing value (T-07C-06).
			return $existing;
		}

		if ( $validated <= 0 ) {
			return 0; // "0" (or a negative, which is never a valid attachment ID) — deliberate removal.
		}

		return $validated;
	}

	/**
	 * upload_size_limit-style boolean check: whether $bytes is within the
	 * D-10 50MB plugin-level avatar upload ceiling.
	 *
	 * Static, mirroring mask_api_key()'s testability decision.
	 *
	 * @param int $bytes File size in bytes.
	 * @return bool True if $bytes is within the 50MB limit, false if it exceeds it.
	 */
	public static function khaveeai_enforce_avatar_size( int $bytes ): bool {
		return $bytes <= self::MAX_AVATAR_BYTES;
	}

	/**
	 * Sanitize a submitted API key value against the masked-placeholder +
	 * format rules (D-05/D-07/D-08; D-06 superseded by Quick-260707-0u6 item 2).
	 *
	 * Signature chosen for pure-function testability: takes the existing key
	 * as a plain parameter rather than resolving it internally (mirrors
	 * OpenAiDirectTokenProvider::mint_session's $api_key-parameter pattern
	 * from 07-PATTERNS.md). This lets the bare-PHP harness assert on the
	 * masking/sanitize logic without a ConfigSource instance — only the class
	 * needs to be loadable.
	 *
	 * Decision order (Quick-260707-0u6 item 2 — blank-and-save IS the removal
	 * signal now; the separate "Remove Key" checkbox is gone):
	 *  1. D-05: if the submitted value equals mask_api_key(existing), the
	 *     admin saved the form without touching the key field — return
	 *     existing unchanged so the masked placeholder is not stored.
	 *  2. If the submitted value is '' after trim, the admin deliberately
	 *     blanked the field and saved — return '' (removal). This INVERTS
	 *     the old D-06 "emptied field is NOT deletion" behavior, which relied
	 *     on a separate checkbox that no longer exists.
	 *  3. D-08: a genuinely new, non-blank value that does not start with
	 *     `sk-` is rejected via add_settings_error() and the existing key is
	 *     kept (no overwrite with a bad value).
	 *  4. Otherwise the new value is valid — return it trimmed.
	 *
	 * @param mixed  $submitted The raw submitted field value.
	 * @param string $existing  The currently-stored API key.
	 * @return string The sanitized key (existing, new, or '' on blank-and-save removal).
	 */
	public function sanitize_api_key( $submitted, string $existing ): string {
		$submitted = is_string( $submitted ) ? trim( $submitted ) : '';
		$masked    = self::mask_api_key( $existing );

		// D-05: unchanged masked field → preserve the existing key, don't overwrite.
		if ( $submitted === $masked ) {
			return $existing;
		}

		// Blank-and-save is the deliberate removal signal (replaces the old
		// checkbox-driven $remove_requested branch).
		if ( '' === $submitted ) {
			return '';
		}

		// D-08: light format check on a genuinely NEW, non-blank value only.
		if ( 0 !== strpos( $submitted, 'sk-' ) ) {
			add_settings_error(
				self::OPTION_NAME,
				'khaveeai_api_key_invalid_format',
				__( 'API key must start with "sk-" and cannot be empty.', 'khaveeai' )
			);
			return $existing; // Reject the bad value — keep the previously stored key.
		}

		return $submitted;
	}

	/**
	 * Sanitize a submitted Khavee Platform API key value (Quick-260703-slv,
	 * T-QK-01/T-QK-05; blank-removal semantics added by Quick-260707-0u6 item 2).
	 *
	 * Same decision order as sanitize_api_key(), with the format gate
	 * checking the `khavee_` prefix instead of `sk-`:
	 *  1. Unchanged masked field (submitted === mask_platform_key(existing))
	 *     → preserve the existing key.
	 *  2. Blank-and-save (submitted is '' after trim) → deliberate removal,
	 *     returns ''.
	 *  3. A genuinely new, non-blank value that does not start with
	 *     `khavee_` is rejected via add_settings_error() and the existing key
	 *     is kept.
	 *  4. Otherwise the new value is valid — return it trimmed.
	 *
	 * @param mixed  $submitted The raw submitted field value.
	 * @param string $existing  The currently-stored platform API key.
	 * @return string The sanitized key (existing, new, or '' on blank-and-save removal).
	 */
	public function sanitize_platform_api_key( $submitted, string $existing ): string {
		$submitted = is_string( $submitted ) ? trim( $submitted ) : '';
		$masked    = self::mask_platform_key( $existing );

		if ( $submitted === $masked ) {
			return $existing;
		}

		if ( '' === $submitted ) {
			return '';
		}

		if ( 0 !== strpos( $submitted, 'khavee_' ) ) {
			add_settings_error(
				self::OPTION_NAME,
				'khaveeai_platform_key_invalid_format',
				__( 'Khavee Platform API key must start with "khavee_" and cannot be empty.', 'khaveeai' )
			);
			return $existing; // Reject the bad value — keep the previously stored key.
		}

		return $submitted;
	}

	// ── Render callback + field renderers ──────────────────────────────

	/**
	 * Render the settings page.
	 *
	 * SET-05: the FIRST statement is an independent current_user_can('manage_options')
	 * check. This is defense-in-depth against Pitfall 3: add_menu_page()'s
	 * capability arg only hides the menu link, it does NOT block direct
	 * navigation to admin.php?page=khaveeai-settings. A user who knows the
	 * URL must still be rejected here, independent of the menu registration.
	 *
	 * @return void
	 */
	public function render_page(): void {
		if ( ! current_user_can( 'manage_options' ) ) { // SET-05 layer 2 (Pitfall 3).
			wp_die( esc_html__( 'You do not have permission to access this page.', 'khaveeai' ) );
		}

		// D-14: "not configured" status banner, same is_configured() check
		// Phase 8's frontend embed notice will also consume.
		if ( ! $this->config_source->is_configured() ) {
			echo '<div class="notice notice-warning"><p>' .
				esc_html__( 'Khavee AI Avatar is not yet configured — enter an OpenAI API key below.', 'khaveeai' ) .
				'</p></div>';
		}

		settings_errors( self::OPTION_NAME );

		// Quick-260703-slv: platform connection-status notice. Reads the raw
		// stored key directly (SettingsPage stays typed to ConfigSourceInterface;
		// the interface deliberately does not expose the platform key) and
		// calls the CACHED PlatformClient::fetch_preview() — cheap even on
		// every render, since a fresh key only re-fetches once (its transient
		// cache is keyed on the key's hash, so saving a new key produces a
		// fresh fetch here on the next render). NEVER echoes the raw key or an
		// exception/stack trace (T-QK-03) — only the project name on success,
		// or PlatformClient's own short generic reason on failure.
		$platform_settings = get_option( self::OPTION_NAME, array() );
		$platform_settings = is_array( $platform_settings ) ? $platform_settings : array();
		$platform_key      = isset( $platform_settings['platform_api_key'] ) ? (string) $platform_settings['platform_api_key'] : '';

		if ( '' !== $platform_key ) {
			$preview = PlatformClient::fetch_preview( $platform_key );

			// Captured for the per-field synced/override renderers below —
			// reuses this exact $preview, never a second fetch_preview() call.
			$this->platform_preview = $preview;

			if ( ! empty( $preview['ok'] ) ) {
				echo '<div class="notice notice-success"><p>' .
					sprintf(
						/* translators: %s: connected project name */
						esc_html__( 'Connected to project: %s', 'khaveeai' ),
						esc_html( (string) $preview['project_name'] )
					) .
					'</p></div>';
			} else {
				echo '<div class="notice notice-warning"><p>' .
					sprintf(
						/* translators: %s: short, generic failure reason (never the raw key or a stack trace) */
						esc_html__( "Couldn't reach Khavee Platform: %s", 'khaveeai' ),
						esc_html( (string) ( $preview['error'] ?? '' ) )
					) .
					'</p></div>';
			}
		}

		wp_enqueue_media(); // D-01: loads wp.media JS for the avatar picker (added by 07-03).

		// REDESIGN 260706-x6b: the following element IDs/classes/data-attributes
		// are read/written by inline JS registered in enqueue_settings_assets()
		// (the rebuild()/wpColorPicker/irischange/CustomEvent wiring, ~lines
		// 332-469) and render_avatar_field()'s wp.media picker script (~lines
		// 1670-1728). They MUST NOT change (id, name, or class) during any
		// future visual/layout edit to this page — only their surrounding
		// container markup/CSS may change:
		//   - #khaveeai-floating-preview (mount div; also carries
		//     data-khaveeai-preview-config and dispatches the
		//     "khaveeai-preview-camera-angle" CustomEvent)
		//   - .khaveeai-color-field (class on #khaveeai_floating_bg_color — the
		//     wpColorPicker() target)
		//   - #khaveeai_floating_bg_color, #khaveeai_floating_bg_transparent,
		//     #khaveeai_floating_avatar_offset_x (+ _out),
		//     #khaveeai_floating_avatar_offset_y (+ _out),
		//     #khaveeai_floating_avatar_scale (+ _out),
		//     #khaveeai_floating_camera_rotation_y (+ _out)
		//   - #khaveeai_avatar_picker_button, #khaveeai_avatar_attachment_id,
		//     #khaveeai_avatar_current
		//   - Not JS-read, but tied to name="khaveeai_settings[...]"
		//     sanitize_settings() keys — ids must stay unchanged regardless:
		//     #khaveeai_api_key, #khaveeai_platform_api_key,
		//     #khaveeai_instructions, #khaveeai_voice, #khaveeai_remove_avatar,
		//     #khaveeai_floating_widget_enabled
		//     (Quick-260707-0u6 item 2: #khaveeai_remove_key and
		//     #khaveeai_remove_platform_key are removed — blank-and-save is
		//     now the removal signal, no separate checkbox.)

		echo '<div class="wrap khaveeai-settings">';
		$this->render_settings_page_styles();
		echo '<h1>' . esc_html__( 'Khavee AI Avatar', 'khaveeai' ) . '</h1>';
		echo '<form method="post" action="options.php">';
		settings_fields( self::OPTION_GROUP );

		// Manual sectioned layout (replaces the single do_settings_sections()
		// call) so each section can render under an uppercase mockup-matching
		// heading. The existing field renderers are called DIRECTLY — they
		// already emit only the input + description, never a label, so the
		// <th> below (standard WP form-table convention) supplies the label.
		echo '<div class="khaveeai-settings__card">';
		$this->render_section_heading( __( 'Connection', 'khaveeai' ), __( 'OpenAI + Khavee Platform API keys', 'khaveeai' ) );
		echo '<table class="form-table" role="presentation"><tbody>';
		$this->render_form_table_row( __( 'OpenAI API Key', 'khaveeai' ), array( $this, 'render_api_key_field' ) );
		$this->render_form_table_row( __( 'Khavee Platform API Key', 'khaveeai' ), array( $this, 'render_platform_api_key_field' ) );
		echo '</tbody></table>';
		echo '</div>';

		echo '<div class="khaveeai-settings__card">';
		$this->render_section_heading( __( 'Personality & Voice', 'khaveeai' ), __( 'How your avatar speaks and behaves', 'khaveeai' ) );
		echo '<table class="form-table" role="presentation"><tbody>';
		$this->render_form_table_row( __( 'Personality / Instructions', 'khaveeai' ), array( $this, 'render_instructions_field' ) );
		$this->render_form_table_row( __( 'Voice', 'khaveeai' ), array( $this, 'render_voice_field' ) );
		echo '</tbody></table>';
		echo '</div>';

		echo '<div class="khaveeai-settings__card">';
		$this->render_section_heading( __( 'Avatar', 'khaveeai' ), __( 'The 3D model your avatar uses', 'khaveeai' ) );
		echo '<table class="form-table" role="presentation"><tbody>';
		$this->render_form_table_row( __( 'Avatar (VRM/GLB)', 'khaveeai' ), array( $this, 'render_avatar_field' ) );
		echo '</tbody></table>';
		// Quick task 260707-0u6 item 3: passive live preview of the global
		// avatar, reusing the SAME khaveeai-preview bundle mount mechanism as
		// render_floating_preview_mount() — no second preview mechanism.
		$this->render_avatar_section_preview_mount();
		echo '</div>';

		// FLOAT-01 (quick task 260704-77n): site-wide floating chat launcher toggle.
		// 260706-x6b: two-column layout — fields (left) | sticky live preview
		// (right) — so the preview stays visible next to the fields instead of
		// scrolling below them. render_floating_preview_mount()'s own markup
		// (mount div id/class/data-attribute/dimensions) is unchanged; only its
		// parent container moves from below the table to this right column.
		echo '<div class="khaveeai-settings__card">';
		$this->render_section_heading( __( 'Floating Widget', 'khaveeai' ) );
		echo '<div class="khaveeai-settings__two-col">';

		echo '<table class="form-table" role="presentation"><tbody>';
		$this->render_form_table_row( __( 'Enable floating widget', 'khaveeai' ), array( $this, 'render_floating_widget_field' ) );
		// Quick task 260705-p30: floating-widget-only visual config, independent
		// of the global avatar/background settings above.
		$this->render_form_table_row( __( 'Floating background color', 'khaveeai' ), array( $this, 'render_floating_bg_color_field' ) );
		$this->render_form_table_row( __( 'Transparent floating background', 'khaveeai' ), array( $this, 'render_floating_bg_transparent_field' ) );
		$this->render_form_table_row( __( 'Floating avatar offset X', 'khaveeai' ), array( $this, 'render_floating_avatar_offset_x_field' ) );
		$this->render_form_table_row( __( 'Floating avatar offset Y', 'khaveeai' ), array( $this, 'render_floating_avatar_offset_y_field' ) );
		$this->render_form_table_row( __( 'Floating avatar scale', 'khaveeai' ), array( $this, 'render_floating_avatar_scale_field' ) );
		// Quick task 260706-wop: floating-only camera angle, also drivable by
		// dragging/orbiting the live preview below (bidirectional).
		$this->render_form_table_row( __( 'Floating camera angle', 'khaveeai' ), array( $this, 'render_floating_camera_rotation_y_field' ) );
		echo '</tbody></table>';

		// Quick task 260706-vf4: live-preview mount point, a SECOND consumer
		// of the already-built `khaveeai-preview` bundle. Moved (260706-x6b)
		// into the sticky right column so it sits beside the fields.
		echo '<div class="khaveeai-settings__preview-col">';
		$this->render_floating_preview_mount();
		echo '</div>';

		echo '</div>'; // .khaveeai-settings__two-col
		echo '</div>'; // .khaveeai-settings__card

		submit_button();
		echo '</form>';
		echo '</div>';
	}

	/**
	 * Emit the page-scoped branded stylesheet (quick task 260706-x6b).
	 *
	 * Everything here is scoped under `.khaveeai-settings` (the wrapper class
	 * added to the page's `<div class="wrap">` in render_page()) so nothing
	 * leaks into other wp-admin chrome. Mirrors packages/wp-bundle/styles.css's
	 * design language — solid `#6929ff` accent, `#dde1ea` borders, 20px/12px
	 * radii, flat surfaces only (no gradients, no box-shadows).
	 *
	 * Printed directly in render_page() (not wp_add_inline_style()) so it is
	 * colocated with the markup and guaranteed to load only on this page,
	 * since render_page() only runs here. Does not touch any existing field
	 * renderer, element id, or name[] attribute.
	 *
	 * @return void
	 */
	private function render_settings_page_styles(): void {
		echo '<style>
.khaveeai-settings__card {
	background: #fff;
	border: 1px solid #dde1ea;
	border-radius: 12px;
	padding: 22px 24px;
	margin: 20px 0;
}
.khaveeai-settings__card-title {
	font-size: 15px;
	font-weight: 600;
	color: #1e1e1e;
	margin: 0 0 4px;
	padding-left: 12px;
	border-left: 3px solid #6929ff;
	line-height: 1.3;
}
.khaveeai-settings__card-description {
	font-size: 13px;
	color: #646970;
	margin: 4px 0 16px 15px;
}
.khaveeai-settings__card .form-table {
	margin-top: 8px;
}
.khaveeai-settings__card .form-table th {
	color: #3c434a;
	font-weight: 600;
	padding: 16px 10px 16px 0;
}
.khaveeai-settings__card .form-table td {
	padding: 12px 10px;
}
.khaveeai-settings__card .form-table tr {
	border-bottom: 1px solid #f0f0f1;
}
.khaveeai-settings__card .form-table tr:last-child {
	border-bottom: none;
}
.khaveeai-settings__card .description {
	color: #646970;
}
.khaveeai-settings__two-col {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 380px;
	gap: 24px;
	align-items: start;
}
.khaveeai-settings__preview-col {
	position: sticky;
	top: 32px;
}
@media (max-width: 1100px) {
	.khaveeai-settings__two-col {
		grid-template-columns: 1fr;
	}
	.khaveeai-settings__preview-col {
		position: static;
		top: auto;
	}
}
.khaveeai-settings input[type="range"],
.khaveeai-settings input[type="checkbox"] {
	accent-color: #6929ff;
}
</style>';
	}

	/**
	 * Emit one card-title heading (quick task 260706-x6b redesign), using the
	 * `.khaveeai-settings__card-title` class defined in
	 * render_settings_page_styles(). Replaces the prior uppercase/bordered
	 * `<h2>` (Task 1's stylesheet is scoped under `.khaveeai-settings`, so this
	 * heading only ever appears inside that wrapper). Optionally emits a short
	 * muted one-line description underneath for scannability.
	 *
	 * Used for all 4 sections (Connection, Personality & Voice, Avatar,
	 * Floating Widget) — Task 2 wraps the first three in
	 * `.khaveeai-settings__card`, Task 3 reuses this same heading for the
	 * Floating Widget card.
	 *
	 * @param string $label       Section label (already translated by the caller).
	 * @param string $description Optional short muted description (already translated).
	 * @return void
	 */
	private function render_section_heading( string $label, string $description = '' ): void {
		printf(
			'<h2 class="khaveeai-settings__card-title">%s</h2>',
			esc_html( $label )
		);
		if ( '' !== $description ) {
			printf(
				'<p class="khaveeai-settings__card-description">%s</p>',
				esc_html( $description )
			);
		}
	}

	/**
	 * Emit one `<tr><th scope="row">{label}</th><td>{callback output}</td></tr>`
	 * form-table row, mirroring the row shape add_settings_field()/
	 * do_settings_sections() would otherwise have produced for the same field
	 * renderer callback.
	 *
	 * @param string   $label    Visible field label (already translated).
	 * @param callable $callback Zero-arg render callback that echoes the field's
	 *                           input/control + description markup.
	 * @return void
	 */
	private function render_form_table_row( string $label, callable $callback ): void {
		echo '<tr><th scope="row">' . esc_html( $label ) . '</th><td>';
		call_user_func( $callback );
		echo '</td></tr>';
	}

	/**
	 * Intro text for the main settings section.
	 *
	 * @return void
	 */
	public function render_main_section_intro(): void {
		echo '<p class="description">' .
			esc_html__( 'Configure the OpenAI API key, personality, voice, and avatar for the Khavee AI Avatar embed.', 'khaveeai' ) .
			'</p>';
	}

	/**
	 * Render the masked API key input (SET-01/D-05/D-07).
	 *
	 * The value attribute is ALWAYS mask_api_key()'s output — never the raw
	 * key. Blank-field-and-save is the deliberate removal signal
	 * (Quick-260707-0u6 item 2; supersedes the old separate remove_key
	 * checkbox).
	 *
	 * @return void
	 */
	public function render_api_key_field(): void {
		$existing = $this->config_source->get_api_key();
		$masked   = self::mask_api_key( $existing ); // T-07B-03: never echo the raw key.
		printf(
			'<input type="text" id="khaveeai_api_key" name="%s[api_key]" value="%s" class="regular-text" autocomplete="new-password" />',
			esc_attr( self::OPTION_NAME ),
			esc_attr( $masked )
		);
		echo '<p class="description">' .
			esc_html__( 'Enter your OpenAI API key (must start with "sk-"). The saved key is shown masked for security. Leave the field blank and save to remove the stored key.', 'khaveeai' ) .
			'</p>';
	}

	/**
	 * Render the masked Khavee Platform API key input (Quick-260703-slv,
	 * T-QK-01).
	 *
	 * Reads the existing platform key directly from get_option() (NOT via
	 * ConfigSourceInterface — the interface deliberately never exposes it)
	 * and echoes ONLY mask_platform_key()'s output in the value attribute
	 * (esc_attr), mirroring render_api_key_field()'s never-echo-the-raw-key
	 * discipline exactly.
	 *
	 * @return void
	 */
	public function render_platform_api_key_field(): void {
		$settings = get_option( self::OPTION_NAME, array() );
		$settings = is_array( $settings ) ? $settings : array();
		$existing = isset( $settings['platform_api_key'] ) ? (string) $settings['platform_api_key'] : '';
		$masked   = self::mask_platform_key( $existing ); // T-QK-01: never echo the raw key.
		printf(
			'<input type="text" id="khaveeai_platform_api_key" name="%s[platform_api_key]" value="%s" class="regular-text" autocomplete="new-password" />',
			esc_attr( self::OPTION_NAME ),
			esc_attr( $masked )
		);
		echo '<p class="description">' .
			esc_html__( 'Optional. When connected, Voice, Instructions, and Avatar below are driven live from this project. The saved key is shown masked for security. Leave the field blank and save to remove the stored key (and disconnect from the Platform).', 'khaveeai' ) .
			'</p>';
	}

	/**
	 * True when $field_key is present in the already-computed
	 * $this->platform_preview for the currently-configured (and reachable)
	 * platform key — the gate every per-field synced/override renderer uses
	 * to decide whether to show the "Synced from Platform" UI or fall
	 * through to the plain, unchanged rendering.
	 *
	 * @param string $field_key One of 'instructions' | 'voice' | 'avatar_url'.
	 * @return bool
	 */
	private function is_field_synced_from_platform( string $field_key ): bool {
		return is_array( $this->platform_preview )
			&& ! empty( $this->platform_preview['ok'] )
			&& isset( $this->platform_preview['fields'][ $field_key ] );
	}

	/**
	 * Emit the "Synced from Platform" pill matching the mockup's .pill.synced
	 * style (inline styles — no separate stylesheet enqueued for this page).
	 *
	 * @return void
	 */
	private function render_synced_pill(): void {
		printf(
			'<span style="display:inline-flex;align-items:center;font-size:11px;font-weight:600;padding:3px 9px;border-radius:99px;background:#f3f2ff;color:#6929ff;margin-left:8px;">%s</span>',
			esc_html__( 'Synced from Platform', 'khaveeai' )
		);
	}

	/**
	 * Emit the read-only, dashed-border platform-value preview box matching
	 * the mockup's .managed-field style.
	 *
	 * @param string $value Already-plain-text value to display (escaped here).
	 * @return void
	 */
	private function render_managed_field_preview( string $value ): void {
		printf(
			'<div style="border:1px dashed #d7cdfb;background:#fbfaff;border-radius:4px;padding:10px 12px;font-size:13px;color:#4a3a8a;line-height:1.5;margin-top:6px;">%s</div>',
			esc_html( $value )
		);
	}

	/**
	 * Render the personality/instructions textarea (SET-02).
	 *
	 * When a connected Platform key's preview includes the 'instructions'
	 * field, shows a "Synced from Platform" pill + a read-only preview of the
	 * platform value, with the original editable textarea moved inside a
	 * native `<details>` "Override locally →" disclosure. Otherwise renders
	 * EXACTLY as before (plain textarea, no pill, no disclosure).
	 *
	 * @return void
	 */
	public function render_instructions_field(): void {
		// Must read the RAW local option, not $this->config_source->get_runtime_config():
		// when PlatformConfigSource is wired in (a Khavee Platform API key is set),
		// get_runtime_config() overlays the platform's instructionPrompt on top of the
		// local value. Displaying that in this editable textarea would silently
		// persist the platform's text into the local 'instructions' option on the
		// very next save (even an unrelated one) — the admin form must always
		// edit the local override, never the resolved runtime blend (found via
		// live testing with a real platform key, 2026-07-03).
		$settings  = get_option( self::OPTION_NAME, array() );
		$settings  = is_array( $settings ) ? $settings : array();
		$stored    = isset( $settings['instructions'] ) ? (string) $settings['instructions'] : '';
		$value     = '' !== $stored ? $stored : 'You are a helpful AI assistant.';
		$synced    = $this->is_field_synced_from_platform( 'instructions' );

		if ( $synced ) {
			$this->render_synced_pill();
			$this->render_managed_field_preview( (string) $this->platform_preview['fields']['instructions'] );
			echo '<details style="margin-top:8px;">';
			echo '<summary style="cursor:pointer;font-size:12px;font-weight:600;color:#6929ff;">' .
				esc_html__( 'Override locally →', 'khaveeai' ) .
				'</summary>';
			echo '<div style="margin-top:10px;">';
		}

		printf(
			'<textarea id="khaveeai_instructions" name="%s[instructions]" rows="5" class="large-text">%s</textarea>',
			esc_attr( self::OPTION_NAME ),
			esc_textarea( $value ) // T-07B-07: textarea-specific escaper.
		);
		echo '<p class="description">' .
			esc_html__( 'The system prompt / personality for the AI assistant.', 'khaveeai' ) .
			'</p>';

		if ( $synced ) {
			echo '<p class="description">' .
				esc_html__( 'This local value only applies if the Platform key is later removed.', 'khaveeai' ) .
				'</p>';
			echo '</div>';
			echo '</details>';
		}
	}

	/**
	 * Render the voice dropdown (SET-03/D-04). Hardcoded enum, no preview.
	 *
	 * @return void
	 */
	public function render_voice_field(): void {
		// Same reasoning as render_instructions_field(): read the raw local
		// option, not the platform-overlaid runtime config, so this <select>'s
		// currently-selected value never round-trips platform data back into
		// the local 'voice' option on save.
		$settings = get_option( self::OPTION_NAME, array() );
		$settings = is_array( $settings ) ? $settings : array();
		$stored   = isset( $settings['voice'] ) ? (string) $settings['voice'] : '';
		$current  = '' !== $stored ? $stored : self::VOICES[0];
		$synced   = $this->is_field_synced_from_platform( 'voice' );

		if ( $synced ) {
			$this->render_synced_pill();
			$this->render_managed_field_preview( (string) $this->platform_preview['fields']['voice'] );
			echo '<details style="margin-top:8px;">';
			echo '<summary style="cursor:pointer;font-size:12px;font-weight:600;color:#6929ff;">' .
				esc_html__( 'Override locally →', 'khaveeai' ) .
				'</summary>';
			echo '<div style="margin-top:10px;">';
		}

		printf( '<select id="khaveeai_voice" name="%s[voice]">', esc_attr( self::OPTION_NAME ) );
		foreach ( self::VOICES as $voice ) {
			printf(
				'<option value="%s"%s>%s</option>',
				esc_attr( $voice ),
				selected( $voice, $current, false ),
				esc_html( $voice )
			);
		}
		echo '</select>';
		echo '<p class="description">' .
			esc_html__( 'The OpenAI Realtime voice the avatar will speak with.', 'khaveeai' ) .
			'</p>';

		if ( $synced ) {
			echo '<p class="description">' .
				esc_html__( 'This local value only applies if the Platform key is later removed.', 'khaveeai' ) .
				'</p>';
			echo '</div>';
			echo '</details>';
		}
	}

	/**
	 * Render the avatar field (SET-04/ASSET-01, D-09/D-10/D-11): a wp.media
	 * picker button, the current-avatar display (filename + upload date
	 * only — no live 3D preview, D-11), a hidden input carrying the selected
	 * attachment_id, and a "Clear avatar" checkbox (D-06-style deliberate
	 * removal, separate from the attachment_id field itself).
	 *
	 * Defense-in-depth: re-asserts current_user_can('manage_options') even
	 * though render_page() already gates the whole page — the avatar
	 * field's output is upload-adjacent and gets its own explicit gate per
	 * CONTEXT.md "Restrict avatar upload to manage_options only" (SET-05
	 * re-assertion for the upload surface, T-07C-04).
	 *
	 * When a connected Platform key's preview includes the 'avatar_url'
	 * field, shows a "Synced from Platform" pill + a read-only preview of
	 * the platform's avatar filename, with the original wp.media picker
	 * moved inside a native `<details>` "Override locally →" disclosure.
	 * Otherwise renders EXACTLY as before (plain picker, no pill/disclosure).
	 *
	 * @return void
	 */
	public function render_avatar_field(): void {
		if ( ! current_user_can( 'manage_options' ) ) { // T-07C-04: defense-in-depth re-check for the upload-adjacent surface.
			return;
		}

		$synced = $this->is_field_synced_from_platform( 'avatar_url' );

		if ( $synced ) {
			$this->render_synced_pill();
			$platform_avatar_url = (string) $this->platform_preview['fields']['avatar_url'];
			// Strip any query string (S3 presigned URLs carry signing params)
			// before taking the basename, so the preview shows a readable
			// filename rather than a wall of X-Amz-* parameters.
			$path_only            = (string) wp_parse_url( $platform_avatar_url, PHP_URL_PATH );
			$display_name         = '' !== $path_only ? basename( $path_only ) : $platform_avatar_url;
			$this->render_managed_field_preview( $display_name );
			echo '<details style="margin-top:8px;">';
			echo '<summary style="cursor:pointer;font-size:12px;font-weight:600;color:#6929ff;">' .
				esc_html__( 'Override locally →', 'khaveeai' ) .
				'</summary>';
			echo '<div style="margin-top:10px;">';
		}

		$settings      = get_option( self::OPTION_NAME, array() );
		$settings      = is_array( $settings ) ? $settings : array();
		$attachment_id = isset( $settings['avatar_attachment_id'] ) ? (int) $settings['avatar_attachment_id'] : 0;

		$filename    = '';
		$upload_date = '';

		if ( $attachment_id > 0 ) {
			$attached_file = get_attached_file( $attachment_id );
			$attachment    = get_post( $attachment_id );
			$filename      = $attached_file ? basename( $attached_file ) : '';
			$upload_date   = $attachment ? (string) $attachment->post_date : '';
		}

		printf(
			'<input type="hidden" id="khaveeai_avatar_attachment_id" name="%s[avatar_attachment_id]" value="%s" />',
			esc_attr( self::OPTION_NAME ),
			esc_attr( (string) $attachment_id )
		);

		echo '<p id="khaveeai_avatar_current">';
		if ( '' !== $filename ) {
			printf(
				/* translators: 1: avatar filename, 2: upload date */
				esc_html__( 'Current avatar: %1$s (uploaded %2$s)', 'khaveeai' ),
				esc_html( $filename ),
				esc_html( $upload_date )
			);
		} else {
			echo esc_html__( 'No avatar configured.', 'khaveeai' );
		}
		echo '</p>';

		printf(
			'<button type="button" class="button" id="khaveeai_avatar_picker_button">%s</button>',
			esc_html__( 'Choose/Upload Avatar', 'khaveeai' )
		);

		printf(
			'<label style="margin-left: 1em;"><input type="checkbox" id="khaveeai_remove_avatar" name="%s[remove_avatar]" value="1" /> %s</label>',
			esc_attr( self::OPTION_NAME ),
			esc_html__( 'Clear avatar (deliberate removal)', 'khaveeai' )
		);

		echo '<p class="description">' .
			esc_html__( 'Accepts .glb or .vrm files only (binary glTF). Max size 50MB. Content is validated server-side beyond the file extension.', 'khaveeai' ) .
			'</p>';

		// D-01: wp_enqueue_media() is already called in render_page(), but
		// WordPress prints the enqueued wp.media JS bundle (media-editor.js,
		// media-views.js, etc.) in the admin FOOTER, which loads AFTER this
		// inline script (printed mid-form, in the page body). Binding the
		// click listener immediately would silently no-op because `wp.media`
		// is still undefined at that point — defer to DOMContentLoaded (with
		// an already-fired fallback) so the listener attaches only once the
		// footer scripts have had a chance to load.
		?>
		<script type="text/javascript">
		( function () {
			// CR-02: the nonce — not the spoofable Referer header alone — is the
			// trust boundary is_khaveeai_upload_request() uses to decide whether
			// the .glb/.vrm content-validation filters activate for this upload
			// POST. Issued server-side via wp_create_nonce() and attached to the
			// wp.media uploader's extra multipart params so it travels with the
			// actual async-upload.php/admin-ajax.php request.
			var khaveeaiAvatarNonce = '<?php echo esc_js( wp_create_nonce( self::AVATAR_UPLOAD_NONCE_ACTION ) ); ?>';

			function khaveeaiInitAvatarPicker() {
				var button = document.getElementById( 'khaveeai_avatar_picker_button' );
				if ( ! button || typeof wp === 'undefined' || ! wp.media ) {
					return;
				}
				var frame = null;
				button.addEventListener( 'click', function ( event ) {
					event.preventDefault();
					if ( null === frame ) {
						frame = wp.media( {
							title: '<?php echo esc_js( __( 'Choose or Upload Avatar', 'khaveeai' ) ); ?>',
							library: { type: 'model/gltf-binary' },
							multiple: false,
						} );
						// CR-02: attach the nonce to the frame's uploader so it rides
						// along with the upload POST as an extra multipart param —
						// wp.media's Uploader merges uploader.params into every
						// request it sends to async-upload.php/admin-ajax.php.
						frame.on( 'ready', function () {
							if ( frame.uploader && frame.uploader.uploader && frame.uploader.uploader.param ) {
								frame.uploader.uploader.param( '<?php echo esc_js( self::AVATAR_UPLOAD_NONCE_FIELD ); ?>', khaveeaiAvatarNonce );
							} else if ( frame.uploader && frame.uploader.options && frame.uploader.options.uploader ) {
								frame.uploader.options.uploader.params = frame.uploader.options.uploader.params || {};
								frame.uploader.options.uploader.params['<?php echo esc_js( self::AVATAR_UPLOAD_NONCE_FIELD ); ?>'] = khaveeaiAvatarNonce;
							}
						} );
						frame.on( 'select', function () {
							var attachment = frame.state().get( 'selection' ).first().toJSON();
							var hidden = document.getElementById( 'khaveeai_avatar_attachment_id' );
							var current = document.getElementById( 'khaveeai_avatar_current' );
							if ( hidden ) {
								hidden.value = attachment.id;
							}
							if ( current ) {
								current.textContent = attachment.filename || attachment.title || '';
							}
						} );
					}
					frame.open();
				} );
			}

			if ( 'loading' === document.readyState ) {
				document.addEventListener( 'DOMContentLoaded', khaveeaiInitAvatarPicker );
			} else {
				khaveeaiInitAvatarPicker();
			}
		} )();
		</script>
		<?php
		if ( $synced ) {
			echo '<p class="description">' .
				esc_html__( 'This local value only applies if the Platform key is later removed.', 'khaveeai' ) .
				'</p>';
			echo '</div>';
			echo '</details>';
		}
	}

	/**
	 * Render the "Enable floating widget" checkbox (FLOAT-01, quick task
	 * 260704-77n) — mirrors render_avatar_field()'s remove_avatar checkbox
	 * pattern, but unlike that transient removal flag, this value IS
	 * persisted (read back via get_option() into `checked()`, not re-derived
	 * each save from a one-shot request flag).
	 *
	 * @return void
	 */
	public function render_floating_widget_field(): void {
		$settings = get_option( self::OPTION_NAME, array() );
		$settings = is_array( $settings ) ? $settings : array();
		$enabled  = ! empty( $settings['floating_widget_enabled'] );

		printf(
			'<label><input type="checkbox" id="khaveeai_floating_widget_enabled" name="%s[floating_widget_enabled]" value="1" %s /> %s</label>',
			esc_attr( self::OPTION_NAME ),
			checked( $enabled, true, false ),
			esc_html__( 'Enable the site-wide floating chat widget', 'khaveeai' )
		);
		echo '<p class="description">' .
			esc_html__( 'Shows a fixed bottom-right launcher on every front-end page, using the global config above — independent of any block or shortcode placement.', 'khaveeai' ) .
			'</p>';
	}

	/**
	 * Render the floating panel's background color input (quick task
	 * 260705-p30) — independent of the inline embed's global background
	 * color above.
	 *
	 * @return void
	 */
	public function render_floating_bg_color_field(): void {
		$settings = get_option( self::OPTION_NAME, array() );
		$settings = is_array( $settings ) ? $settings : array();
		$current  = isset( $settings['floating_bg_color'] ) ? (string) $settings['floating_bg_color'] : '';

		// Quick task 260706-vf4: `khaveeai-color-field` class lets the inline
		// script (render_page()'s enqueue_settings_assets()) call
		// wpColorPicker() on this input. It stays a plain type="text" input —
		// wp-color-picker enhances it in place — so name/id/value semantics
		// (and therefore sanitize_settings()) are completely unaffected.
		printf(
			'<input type="text" id="khaveeai_floating_bg_color" name="%s[floating_bg_color]" value="%s" class="regular-text khaveeai-color-field" placeholder="#6929ff" />',
			esc_attr( self::OPTION_NAME ),
			esc_attr( $current )
		);
		echo '<p class="description">' .
			esc_html__( 'Background color for the floating widget\'s avatar area only. Leave blank for the default purple.', 'khaveeai' ) .
			'</p>';
	}

	/**
	 * Render the floating panel's transparent-background checkbox (quick
	 * task 260705-p30) — mirrors render_floating_widget_field()'s checkbox
	 * pattern exactly.
	 *
	 * @return void
	 */
	public function render_floating_bg_transparent_field(): void {
		$settings = get_option( self::OPTION_NAME, array() );
		$settings = is_array( $settings ) ? $settings : array();
		$enabled  = ! empty( $settings['floating_bg_transparent'] );

		printf(
			'<label><input type="checkbox" id="khaveeai_floating_bg_transparent" name="%s[floating_bg_transparent]" value="1" %s /> %s</label>',
			esc_attr( self::OPTION_NAME ),
			checked( $enabled, true, false ),
			esc_html__( 'Make the floating widget\'s avatar-area background transparent', 'khaveeai' )
		);
		echo '<p class="description">' .
			esc_html__( 'When enabled, overrides the floating background color above.', 'khaveeai' ) .
			'</p>';
	}

	/**
	 * Render the floating panel's horizontal avatar offset input (quick
	 * task 260705-p30) — independent of the inline embed's global avatar
	 * offset X above.
	 *
	 * @return void
	 */
	public function render_floating_avatar_offset_x_field(): void {
		$settings = get_option( self::OPTION_NAME, array() );
		$settings = is_array( $settings ) ? $settings : array();
		$current  = isset( $settings['floating_avatar_offset_x'] ) ? (float) $settings['floating_avatar_offset_x'] : 0.0;

		// Quick task 260706-vf4: range slider (min/max/step mirror editor.js's
		// avatarOffsetX RangeControl, lines 528-538) plus a sibling <output>
		// live-readout element. Same id/name as before — sanitize_settings()
		// and the persisted option shape are unaffected.
		printf(
			'<span style="display:flex;align-items:center;gap:12px;"><input type="range" min="-1" max="1" step="0.05" id="khaveeai_floating_avatar_offset_x" name="%s[floating_avatar_offset_x]" value="%s" /><output id="khaveeai_floating_avatar_offset_x_out" for="khaveeai_floating_avatar_offset_x">%s</output></span>',
			esc_attr( self::OPTION_NAME ),
			esc_attr( (string) $current ),
			esc_html( (string) $current )
		);
		echo '<p class="description">' .
			esc_html__( 'Horizontal avatar offset for the floating widget only. 0 = centred.', 'khaveeai' ) .
			'</p>';
	}

	/**
	 * Render the floating panel's vertical avatar offset input (quick task
	 * 260705-p30) — independent of the inline embed's global avatar offset
	 * Y above.
	 *
	 * @return void
	 */
	public function render_floating_avatar_offset_y_field(): void {
		$settings = get_option( self::OPTION_NAME, array() );
		$settings = is_array( $settings ) ? $settings : array();
		$current  = isset( $settings['floating_avatar_offset_y'] ) ? (float) $settings['floating_avatar_offset_y'] : 0.0;

		// Quick task 260706-vf4: range slider (min/max/step mirror editor.js's
		// avatarOffsetY RangeControl, lines 540-548) plus a sibling <output>
		// live-readout element. Same id/name as before — sanitize_settings()
		// and the persisted option shape are unaffected.
		printf(
			'<span style="display:flex;align-items:center;gap:12px;"><input type="range" min="-1" max="1" step="0.05" id="khaveeai_floating_avatar_offset_y" name="%s[floating_avatar_offset_y]" value="%s" /><output id="khaveeai_floating_avatar_offset_y_out" for="khaveeai_floating_avatar_offset_y">%s</output></span>',
			esc_attr( self::OPTION_NAME ),
			esc_attr( (string) $current ),
			esc_html( (string) $current )
		);
		echo '<p class="description">' .
			esc_html__( 'Vertical avatar offset for the floating widget only. 0 = centred.', 'khaveeai' ) .
			'</p>';
	}

	/**
	 * Render the floating panel's avatar scale input (quick task
	 * 260705-p30) — independent of the inline embed's global avatar scale
	 * above.
	 *
	 * @return void
	 */
	public function render_floating_avatar_scale_field(): void {
		$settings = get_option( self::OPTION_NAME, array() );
		$settings = is_array( $settings ) ? $settings : array();
		$current  = ( isset( $settings['floating_avatar_scale'] ) && (float) $settings['floating_avatar_scale'] > 0 )
			? (float) $settings['floating_avatar_scale']
			: 1.0;

		// Quick task 260706-vf4: range slider (min/max/step mirror editor.js's
		// avatarScale GlobalCustomRange, lines 518-527) plus a sibling
		// <output> live-readout element. Same id/name as before, and the
		// `> 0`-sentinel read above is preserved — sanitize_settings() and
		// the persisted option shape are unaffected.
		printf(
			'<span style="display:flex;align-items:center;gap:12px;"><input type="range" min="0.5" max="2" step="0.05" id="khaveeai_floating_avatar_scale" name="%s[floating_avatar_scale]" value="%s" /><output id="khaveeai_floating_avatar_scale_out" for="khaveeai_floating_avatar_scale">%s</output></span>',
			esc_attr( self::OPTION_NAME ),
			esc_attr( (string) $current ),
			esc_html( (string) $current )
		);
		echo '<p class="description">' .
			esc_html__( 'Avatar scale multiplier for the floating widget only. 1.0 = natural size.', 'khaveeai' ) .
			'</p>';
	}

	/**
	 * Render the floating panel's camera angle input (quick task
	 * 260706-wop) — independent of the inline embed's global camera
	 * rotation. Also drivable by dragging/orbiting the live preview below;
	 * enqueue_settings_assets()'s inline JS listens for the preview's
	 * `khaveeai-preview-camera-angle` CustomEvent and writes the dragged
	 * angle back into this slider (see that method's doc comment).
	 *
	 * @return void
	 */
	public function render_floating_camera_rotation_y_field(): void {
		$settings = get_option( self::OPTION_NAME, array() );
		$settings = is_array( $settings ) ? $settings : array();
		$current  = isset( $settings['floating_camera_rotation_y'] ) ? (float) $settings['floating_camera_rotation_y'] : 0.0;

		// Mirrors render_floating_avatar_scale_field()'s slider+output pattern
		// verbatim. min/max/step match the (-180,180] range angleFromCameraPosition
		// (packages/wp-bundle/src/config.ts) normalizes drag-read angles into.
		printf(
			'<span style="display:flex;align-items:center;gap:12px;"><input type="range" min="-180" max="180" step="1" id="khaveeai_floating_camera_rotation_y" name="%s[floating_camera_rotation_y]" value="%s" /><output id="khaveeai_floating_camera_rotation_y_out" for="khaveeai_floating_camera_rotation_y">%s</output></span>',
			esc_attr( self::OPTION_NAME ),
			esc_attr( (string) $current ),
			esc_html( (string) $current )
		);
		echo '<p class="description">' .
			esc_html__( 'Camera angle in degrees for the floating widget only. Dragging/orbiting the live preview below also updates this.', 'khaveeai' ) .
			'</p>';
	}

	/**
	 * Render a small, passive live preview of the GLOBAL avatar inside the
	 * Avatar section's card (quick task 260707-0u6 item 3) — reuses the SAME
	 * khaveeai-preview bundle mount mechanism render_floating_preview_mount()
	 * uses (each mount is its own WebGL context; a second mount div with
	 * data-khaveeai-preview-config on the same admin page is fine and is
	 * auto-picked-up by the bundle's observeDocument(document) scan). This is
	 * a passive "here's your model" preview with no editable visual fields —
	 * the Avatar section has no floating/global visual sliders, so no new
	 * inline JS/live-wiring is added here.
	 *
	 * Uses a DISTINCT mount id (#khaveeai-avatar-preview, never
	 * #khaveeai-floating-preview) so it cannot collide with the floating
	 * preview mount or anything in the JS-read id list in render_page()'s
	 * "DO NOT CHANGE THESE IDS" comment block. Does not touch
	 * render_floating_preview_mount(), enqueue_settings_assets(), preview.ts,
	 * or the build.
	 *
	 * @return void
	 */
	private function render_avatar_section_preview_mount(): void {
		$runtime_config = $this->config_source->get_runtime_config();
		$avatar_url     = isset( $runtime_config['avatar_url'] ) ? (string) $runtime_config['avatar_url'] : '';

		$config = array(
			'avatarUrl'       => $avatar_url,
			'bgType'          => 'color',
			'bgColor'         => '#f6f7f9', // Neutral light default — passive "here's your model" preview.
			'bgTransparent'   => false,
			'avatarScale'     => 1.0,
			'avatarOffsetX'   => 0.0,
			'avatarOffsetY'   => 0.0,
			'cameraRotationY' => 0.0,
		);

		echo '<p style="margin-top:16px;"><strong>' . esc_html__( 'Live preview', 'khaveeai' ) . '</strong></p>';
		printf(
			'<div id="khaveeai-avatar-preview" class="khaveeai-root" data-khaveeai-preview-config="%s" style="width:280px;height:340px;border:1px solid #dde1ea;border-radius:20px;overflow:hidden;"></div>',
			esc_attr( wp_json_encode( $config ) )
		);
	}

	/**
	 * Render the Floating Widget live-preview mount point (quick task
	 * 260706-vf4) — a SECOND consumer of the already-built `khaveeai-preview`
	 * bundle (same one the Gutenberg block editor uses via editor.js's own
	 * mount point). This task never touches preview.ts, build.mjs, the
	 * STUDIO-02 grep assertion, or Plugin::register_preview_bundle().
	 *
	 * Maps the five floating_* settings into the GENERIC config keys
	 * PreviewScene.tsx actually reads — avatarUrl/bgType/bgColor/
	 * bgTransparent/avatarScale/avatarOffsetX/avatarOffsetY. PreviewScene
	 * does NOT read the floatingBg* / floatingAvatar* keys; those remain
	 * AvatarRenderer::render_floating()'s OWN separate output for the real
	 * runtime floating widget and are untouched by this method.
	 *
	 * The bundle's own observeDocument(document) fallback (preview.ts,
	 * non-iframe path, lines 164-170) scans the TOP admin document for
	 * [data-khaveeai-preview-config] and auto-mounts this div — no JS call
	 * is needed here to trigger the initial mount.
	 * enqueue_settings_assets()'s inline script then rewrites this div's
	 * data-khaveeai-preview-config attribute live as the five floating
	 * fields change (mountPreview.tsx's MutationObserver re-renders without
	 * tearing down the WebGL context).
	 *
	 * @return void
	 */
	private function render_floating_preview_mount(): void {
		$settings = get_option( self::OPTION_NAME, array() );
		$settings = is_array( $settings ) ? $settings : array();

		$runtime_config = $this->config_source->get_runtime_config();
		$avatar_url     = isset( $runtime_config['avatar_url'] ) ? (string) $runtime_config['avatar_url'] : '';

		$bg_color = ( isset( $settings['floating_bg_color'] ) && '' !== (string) $settings['floating_bg_color'] )
			? (string) $settings['floating_bg_color']
			: '#6929ff';

		$avatar_scale = ( isset( $settings['floating_avatar_scale'] ) && (float) $settings['floating_avatar_scale'] > 0 )
			? (float) $settings['floating_avatar_scale']
			: 1.0;

		$config = array(
			'avatarUrl'     => $avatar_url,
			'bgType'        => 'color',
			'bgColor'       => $bg_color,
			'bgTransparent' => ! empty( $settings['floating_bg_transparent'] ),
			'avatarScale'   => $avatar_scale,
			'avatarOffsetX' => isset( $settings['floating_avatar_offset_x'] ) ? (float) $settings['floating_avatar_offset_x'] : 0.0,
			'avatarOffsetY' => isset( $settings['floating_avatar_offset_y'] ) ? (float) $settings['floating_avatar_offset_y'] : 0.0,
			'cameraRotationY' => isset( $settings['floating_camera_rotation_y'] ) ? (float) $settings['floating_camera_rotation_y'] : 0.0,
		);

		echo '<p><strong>' . esc_html__( 'Live preview', 'khaveeai' ) . '</strong></p>';
		// Quick task 260707-0u6 item 1: clarify that dragging orbits the CAMERA,
		// not the avatar — the sliders (offset X/Y, scale) are what move the
		// avatar itself. Additive markup only; no id/name/data-attribute/behavior
		// change to the mount div below.
		echo '<p class="description" style="margin-top:-6px;margin-bottom:10px;">' .
			esc_html__( 'Drag to rotate the camera view. Use the sliders on the left to reposition and resize the avatar itself.', 'khaveeai' ) .
			'</p>';
		// ~360x520 matches the real .khaveeai-floating-panel proportions
		// (styles.css: width:360px;height:520px) so the preview is a
		// faithful representation of the actual floating widget.
		printf(
			'<div id="khaveeai-floating-preview" class="khaveeai-root" data-khaveeai-preview-config="%s" style="width:360px;height:520px;border:1px solid #dde1ea;border-radius:20px;overflow:hidden;"></div>',
			esc_attr( wp_json_encode( $config ) )
		);

		$this->render_floating_preview_mock_chat();
	}

	/**
	 * Emit a STATIC, non-interactive mock chat transcript below the floating
	 * preview's avatar mount (quick task 260707-0u6 item 6) so the preview
	 * shows both the avatar and a representative chat, matching the real
	 * floating widget's visual chat layout.
	 *
	 * Reuses the SAME compiled floating/chat classes already loaded on this
	 * page via the khaveeai-preview-style stylesheet (build/khaveeai-preview.css,
	 * compiled from packages/wp-bundle/styles.css's .khaveeai-chat* rules) —
	 * no new stylesheet, no JS, no input row/send button, not wired to any
	 * chat logic. Constrained to the 360px preview panel's width.
	 *
	 * @return void
	 */
	private function render_floating_preview_mock_chat(): void {
		echo '<div class="khaveeai-chat khaveeai-chat--below" style="width:360px;margin:12px 0 0;max-height:none;">';
		echo '<div class="khaveeai-chat__transcript">';

		printf(
			'<div class="khaveeai-chat__bubble khaveeai-chat__bubble--assistant">%s</div>',
			esc_html__( 'Hi! How can I help you today?', 'khaveeai' )
		);
		printf(
			'<div class="khaveeai-chat__bubble khaveeai-chat__bubble--user">%s</div>',
			esc_html__( 'What are your opening hours?', 'khaveeai' )
		);
		printf(
			'<div class="khaveeai-chat__bubble khaveeai-chat__bubble--assistant">%s</div>',
			esc_html__( "We're open 9am to 6pm, Monday to Friday.", 'khaveeai' )
		);

		echo '</div>'; // .khaveeai-chat__transcript
		echo '</div>'; // .khaveeai-chat
	}
}
