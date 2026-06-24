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
 *    khaveeai_allow_glb_vrm_mimes) are registered screen-scoped via
 *    load-<hook_suffix> (Open Question 2 / Assumption A2 resolution, T-07C-01/
 *    T-07C-02/T-07C-03) — never globally — and render_avatar_field() re-asserts
 *    current_user_can('manage_options') as defense-in-depth for the upload
 *    surface specifically (T-07C-04).
 *
 * @package Khavee\Plugin\Admin
 */

namespace Khavee\Plugin\Admin;

use Khavee\Plugin\ConfigSource\ConfigSourceInterface;

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
	 * The shared ConfigSourceInterface (is_configured() + get_api_key()
	 * consumed in sanitize/render). Constructor-injected — never construct a
	 * concrete WpOptionsConfigSource here; Plugin.php owns that.
	 *
	 * @var ConfigSourceInterface
	 */
	private $config_source;

	/**
	 * The hook suffix add_menu_page() returns, used to screen-scope the
	 * avatar upload content-validation filters via load-<hook_suffix>
	 * (Open Question 2 / Assumption A2 resolution — see register_hooks()
	 * and register_avatar_upload_filters() below). Populated by
	 * add_menu_page() itself; empty string until that hook fires.
	 *
	 * @var string
	 */
	private $settings_page_hook = '';

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
		$hook_suffix = add_menu_page(
			__( 'Khavee AI Avatar', 'khaveeai' ),
			__( 'Khavee AI Avatar', 'khaveeai' ),
			'manage_options', // D-02/SET-05: capability gate at registration.
			self::PAGE_SLUG,
			array( $this, 'render_page' ),
			'dashicons-microphone'
		);

		if ( is_string( $hook_suffix ) ) {
			$this->settings_page_hook = $hook_suffix;
			// Open Question 2 / A2 resolution: screen-scoped (load-<hook_suffix>)
			// registration of the avatar upload content-validation filters. This
			// fires ONCE per admin page-load of the khaveeai settings screen and
			// stays registered for every AJAX request the wp.media frame on that
			// screen triggers (including async-upload.php fired from the Upload
			// tab — that AJAX handler inherits the parent admin screen's filter
			// registrations for the duration of the page session), and is removed
			// before any other admin screen renders (admin_footer, below).
			// Narrower than global (Pitfall 4), wider than per-upload-call —
			// matching 07-RESEARCH.md Open Question 2's recommendation. Empirically
			// verified by the 07-03 Task 3 human checkpoint.
			add_action( 'load-' . $hook_suffix, array( $this, 'register_avatar_upload_filters' ) );
		}
	}

	/**
	 * Register the two avatar upload content-validation filters
	 * (upload_mimes, wp_check_filetype_and_ext) plus the 50MB size cap,
	 * scoped to fire only while the khaveeai settings screen is loaded
	 * (see add_menu_page()'s load-<hook_suffix> registration above).
	 * Removes itself via admin_footer on the SAME screen load so the
	 * standard Media Library "Add New" screen never inherits these filters
	 * (Pitfall 4, T-07C-03).
	 *
	 * @return void
	 */
	public function register_avatar_upload_filters(): void {
		add_filter( 'upload_mimes', __NAMESPACE__ . '\\khaveeai_allow_glb_vrm_mimes' );
		add_filter( 'wp_check_filetype_and_ext', __NAMESPACE__ . '\\khaveeai_validate_glb_vrm_content', 10, 5 );
		add_filter( 'upload_size_limit', array( $this, 'limit_avatar_upload_size' ) );

		add_action( 'admin_footer', array( $this, 'remove_avatar_upload_filters' ) );
	}

	/**
	 * Remove the avatar upload content-validation filters at the end of the
	 * khaveeai settings screen's page lifecycle (Pitfall 4, T-07C-03) — the
	 * standard Media Library "Add New" screen and every other upload path on
	 * the site must continue to reject .glb/.vrm.
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

		add_settings_field(
			'remove_key',
			__( 'Remove Key', 'khaveeai' ),
			array( $this, 'render_remove_key_field' ),
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
	}

	// ── Sanitize orchestrator + key sanitize logic ─────────────────────

	/**
	 * Settings API sanitize_callback for the whole khaveeai_settings option.
	 *
	 * Orchestrates per-field sanitization. Reads the existing stored option
	 * for the non-key fields (so an absent field on a partial POST preserves
	 * prior values), resolves the existing api_key via the injected
	 * ConfigSourceInterface, interprets the D-06 remove_key checkbox flag,
	 * and returns the merged sanitized array. NEVER calls update_option()
	 * directly — register_setting()'s returned sanitize_callback value is
	 * what WordPress persists.
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
		$remove_requested    = isset( $input['remove_key'] ) && '1' === (string) $input['remove_key'];
		$submitted_instr     = isset( $input['instructions'] ) ? (string) $input['instructions'] : '';
		$submitted_voice     = isset( $input['voice'] ) ? (string) $input['voice'] : '';

		$existing_attachment_id   = isset( $existing_option['avatar_attachment_id'] ) ? (int) $existing_option['avatar_attachment_id'] : 0;
		$submitted_attachment_id  = $input['avatar_attachment_id'] ?? '';
		$remove_avatar_requested  = isset( $input['remove_avatar'] ) && '1' === (string) $input['remove_avatar'];

		$sanitized = $existing_option; // Preserve any prior keys (model untouched per D-03).

		$sanitized['api_key']      = $this->sanitize_api_key( $submitted_api_key, $existing_api_key, $remove_requested );
		$sanitized['instructions'] = sanitize_textarea_field( $submitted_instr );
		$sanitized['voice']        = sanitize_text_field( $submitted_voice );

		if ( $remove_avatar_requested ) {
			// D-06-style deliberate removal: the "Clear avatar" checkbox forces 0
			// regardless of whatever attachment ID was submitted alongside it.
			$sanitized['avatar_attachment_id'] = 0;
		} else {
			$sanitized['avatar_attachment_id'] = self::sanitize_avatar_attachment_id( $submitted_attachment_id, $existing_attachment_id );
		}

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
	 * format rules (D-05/D-06/D-07/D-08).
	 *
	 * Signature chosen for pure-function testability: takes the existing key
	 * and the remove-request flag as plain parameters rather than resolving
	 * them internally (mirrors OpenAiDirectTokenProvider::mint_session's
	 * $api_key-parameter pattern from 07-PATTERNS.md). This lets the bare-PHP
	 * harness assert on the masking/sanitize logic without a ConfigSource
	 * instance — only the class needs to be loadable.
	 *
	 * Decision order:
	 *  1. D-06: if remove_requested is true, return '' (deliberate removal
	 *     via the separate checkbox — never inferred from an emptied field).
	 *  2. D-05: if the submitted value equals mask_api_key(existing), the
	 *     admin saved the form without touching the key field — return
	 *     existing unchanged so the masked placeholder is not stored.
	 *  3. D-08: a genuinely new value that is empty-after-trim or does not
	 *     start with `sk-` is rejected via add_settings_error() and the
	 *     existing key is kept (no overwrite with a bad value).
	 *  4. Otherwise the new value is valid — return it trimmed.
	 *
	 * @param mixed  $submitted        The raw submitted field value.
	 * @param string $existing         The currently-stored API key.
	 * @param bool   $remove_requested Whether the D-06 remove-key checkbox was checked.
	 * @return string The sanitized key (existing, new, or '' on deliberate removal).
	 */
	public function sanitize_api_key( $submitted, string $existing, bool $remove_requested = false ): string {
		// D-06: deliberate removal via the dedicated checkbox control.
		if ( $remove_requested ) {
			return '';
		}

		$submitted = is_string( $submitted ) ? trim( $submitted ) : '';
		$masked    = self::mask_api_key( $existing );

		// D-05: unchanged masked field → preserve the existing key, don't overwrite.
		if ( $submitted === $masked ) {
			return $existing;
		}

		// D-08: light format check on a genuinely NEW value only.
		if ( '' === $submitted || 0 !== strpos( $submitted, 'sk-' ) ) {
			add_settings_error(
				self::OPTION_NAME,
				'khaveeai_api_key_invalid_format',
				__( 'API key must start with "sk-" and cannot be empty.', 'khaveeai' )
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

		wp_enqueue_media(); // D-01: loads wp.media JS for the avatar picker (added by 07-03).

		echo '<div class="wrap">';
		echo '<h1>' . esc_html__( 'Khavee AI Avatar', 'khaveeai' ) . '</h1>';
		echo '<form method="post" action="options.php">';
		settings_fields( self::OPTION_GROUP );
		do_settings_sections( self::PAGE_SLUG );
		submit_button();
		echo '</form>';
		echo '</div>';
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
	 * key. An emptied field is NOT a deletion signal (D-06); the separate
	 * remove_key checkbox handles deliberate removal.
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
			esc_html__( 'Enter your OpenAI API key (must start with "sk-"). The saved key is shown masked for security.', 'khaveeai' ) .
			'</p>';
	}

	/**
	 * Render the D-06 "Remove key" checkbox control. Checking this on save
	 * clears the stored key; leaving it unchecked preserves whatever the
	 * sanitize_api_key() placeholder/fresh-key logic decided.
	 *
	 * @return void
	 */
	public function render_remove_key_field(): void {
		printf(
			'<label><input type="checkbox" id="khaveeai_remove_key" name="%s[remove_key]" value="1" /> %s</label>',
			esc_attr( self::OPTION_NAME ),
			esc_html__( 'Clear the saved API key (deliberate removal)', 'khaveeai' )
		);
		echo '<p class="description">' .
			esc_html__( 'Check this box and save to remove the stored API key. An emptied key field alone does NOT clear the key.', 'khaveeai' ) .
			'</p>';
	}

	/**
	 * Render the personality/instructions textarea (SET-02).
	 *
	 * @return void
	 */
	public function render_instructions_field(): void {
		$runtime   = $this->config_source->get_runtime_config();
		$value     = isset( $runtime['instructions'] ) ? (string) $runtime['instructions'] : '';
		printf(
			'<textarea id="khaveeai_instructions" name="%s[instructions]" rows="5" class="large-text">%s</textarea>',
			esc_attr( self::OPTION_NAME ),
			esc_textarea( $value ) // T-07B-07: textarea-specific escaper.
		);
		echo '<p class="description">' .
			esc_html__( 'The system prompt / personality for the AI assistant.', 'khaveeai' ) .
			'</p>';
	}

	/**
	 * Render the voice dropdown (SET-03/D-04). Hardcoded enum, no preview.
	 *
	 * @return void
	 */
	public function render_voice_field(): void {
		$runtime = $this->config_source->get_runtime_config();
		$current = isset( $runtime['voice'] ) ? (string) $runtime['voice'] : '';
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
	 * @return void
	 */
	public function render_avatar_field(): void {
		if ( ! current_user_can( 'manage_options' ) ) { // T-07C-04: defense-in-depth re-check for the upload-adjacent surface.
			return;
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

		// D-01: wp_enqueue_media() is already called in render_page(); the
		// wp.media frame is restricted to library type 'model/gltf-binary'
		// (D-09 client-side reinforcement — server-side validation via
		// khaveeai_validate_glb_vrm_content() is the real enforcement).
		?>
		<script type="text/javascript">
		( function () {
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
		} )();
		</script>
		<?php
	}
}
