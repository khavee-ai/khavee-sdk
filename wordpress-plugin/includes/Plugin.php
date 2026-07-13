<?php
/**
 * Plugin — the composition root. This is the ONE place in the plugin
 * that knows which concrete strategies are active.
 *
 * @package Khavee\Plugin
 */

namespace Khavee\Plugin;

use Khavee\Plugin\Admin\SettingsPage;
use Khavee\Plugin\ConfigSource\WpOptionsConfigSource;
use Khavee\Plugin\ConfigSource\PlatformConfigSource;
use Khavee\Plugin\TokenProvider\OpenAiDirectTokenProvider;
use Khavee\Plugin\RateLimit\RateLimiter;
use Khavee\Plugin\Rest\SessionController;
use Khavee\Plugin\Rest\KnowledgeSearchController;
use Khavee\Plugin\Render\AvatarRenderer;
use Khavee\Plugin\Assets\AssetManager;
use Khavee\Plugin\Shortcode\AvatarShortcode;
use Khavee\Plugin\Block\AvatarBlock;
use YahnisElsts\PluginUpdateChecker\v5\PucFactory;

/**
 * Constructs the concrete ConfigSource/TokenProvider/RateLimiter
 * strategies, injects them into SessionController via its
 * interface-typed constructor, registers the REST route, and wires the
 * admin SettingsPage.
 *
 * No DI container, no filter-hook-driven strategy selection — per
 * ARCHITECTURE.md's "Internal Boundaries" note, the composition root
 * choosing the concrete class directly is sufficient for this milestone
 * (exactly one concrete implementation per strategy). A future
 * Platform-mode config/token strategy would be wired in here, and only
 * here.
 */
final class Plugin {

	/**
	 * Shared AvatarRenderer instance, set once in boot() (Phase 8's
	 * composition-root $renderer local, promoted to a static property so
	 * render_floating_widget() — a static wp_footer callback — can reach
	 * it) so the wp_footer floating-widget hook (FLOAT-01, quick task
	 * 260704-77n) reuses the exact same shortcode/block render path instead
	 * of constructing a second renderer.
	 *
	 * @var AvatarRenderer|null
	 */
	private static ?AvatarRenderer $floating_renderer = null;

	/**
	 * Once-guard (T-77n-04): ensures render_floating_widget() echoes at most
	 * one mount point per page load even if wp_footer somehow fires more
	 * than once (defensive — WordPress core only fires it once per request,
	 * but this makes the guarantee explicit and independent of that).
	 *
	 * @var bool
	 */
	private static bool $floating_widget_rendered = false;

	/**
	 * Boot the plugin: wire concretes into SessionController and
	 * SettingsPage, and register the REST route on rest_api_init.
	 *
	 * @return void
	 */
	public static function boot(): void {
		// Self-hosted auto-updates: this plugin isn't on WordPress.org,
		// so without this, site owners would have to manually download
		// a new zip and re-upload it via wp-admin on every release.
		// Wired unconditionally (not behind a strategy interface) since
		// there's only one update source this milestone — GitHub
		// Releases on this repo. Release-asset mode is required (not
		// the default "build a zip from the repo" mode) because the
		// release zip's directory layout (vendor/, build/ included;
		// tests/, src/ excluded) differs from the raw repo tree.
		$update_checker = PucFactory::buildUpdateChecker(
			'https://github.com/khavee-ai/khavee-sdk/',
			KHAVEEAI_PLUGIN_FILE,
			'khaveeai-ai-avatar'
		);
		$update_checker->getVcsApi()->enableReleaseAssets();

		// Quick-260703-slv: PlatformConfigSource wraps WpOptionsConfigSource
		// so a configured Khavee Platform API key overlays mapped fields
		// (voice, instructions, avatar_url, light_intensity, background)
		// on top of the WP-admin config — "platform always wins" when a
		// key is set, with a silent fallback to the wrapped source on any
		// failure. This is the ONLY composition-root change; SessionController/
		// AvatarRenderer/AvatarBlock/SettingsPage all keep depending on
		// ConfigSourceInterface and need no edits.
		$config_source  = new PlatformConfigSource( new WpOptionsConfigSource() );
		$token_provider = new OpenAiDirectTokenProvider();
		$rate_limiter   = new RateLimiter();

		$session_controller = new SessionController( $config_source, $token_provider, $rate_limiter );

		add_action( 'rest_api_init', array( $session_controller, 'register_routes' ) );

		// Knowledge-base tool-call search route (public/unauthenticated —
		// same rationale as SessionController above: the Platform API key
		// stays server-side, the route itself has no auth boundary).
		$knowledge_search_controller = new KnowledgeSearchController();

		add_action( 'rest_api_init', array( $knowledge_search_controller, 'register_routes' ) );

		// $config_source is deliberately the SAME instance shared with
		// SessionController above — SettingsPage only reads is_configured()/
		// get_api_key()/get_runtime_config() through the interface, never a
		// second WpOptionsConfigSource.
		$settings_page = new SettingsPage( $config_source );
		$settings_page->register_hooks();

		// Phase 8: shared render path. $renderer is reused by BOTH the
		// shortcode and the block below — shortcode and block must funnel
		// through one AvatarRenderer (EMBED-04), never construct their own.
		$assets   = new AssetManager();
		$renderer = new AvatarRenderer( $config_source, $assets );

		self::$floating_renderer = $renderer;

		$shortcode = new AvatarShortcode( $renderer );
		$shortcode->register();

		$block = new AvatarBlock( $renderer );
		add_action( 'init', array( $block, 'register' ) );

		// FLOAT-01 (quick task 260704-77n): site-wide floating chat launcher,
		// independent of any shortcode/block placement. wp_footer is
		// front-end-only by definition; render_floating_widget() ALSO
		// early-returns on is_admin() as defense-in-depth (T-77n-03).
		add_action( 'wp_footer', array( __CLASS__, 'render_floating_widget' ) );

		// Phase 9: register khaveeai-preview so block.json's editorScript array
		// can reference it by handle. Registration runs in init (priority 9, before
		// AvatarBlock::register at priority 10) so the handle exists when
		// register_block_type resolves the editorScript list.
		// The script is editor-only: block.json lists it in "editorScript" (not
		// "script" / "viewScript"), so it is never enqueued on published pages
		// (Pitfall 5 / PERF-01). NOTE (corrected 2026-07-02): editorScript does
		// NOT load the script inside the Gutenberg block-canvas iframe — it
		// still executes in the top admin window, same as any other admin
		// script. Confirmed against Gutenberg's actual behaviour (gutenberg#59528,
		// #44945, #38673) — a prior assumption here that editorScript ran inside
		// the iframe was wrong and was the root cause of the preview never
		// updating. The preview bundle itself (packages/wp-bundle/src/preview.ts)
		// is responsible for locating `<iframe name="editor-canvas">` and
		// scanning/observing ITS document instead of the top document.
		add_action( 'init', array( __CLASS__, 'register_preview_bundle' ), 9 );
	}

	/**
	 * Enqueue the safe-preview IIFE (built by esbuild from
	 * packages/wp-bundle/src/preview.ts) for the Gutenberg block editor only.
	 *
	 * Why enqueue_block_editor_assets and NOT the front-end enqueue hook:
	 *   WordPress core fires enqueue_block_editor_assets exclusively inside the
	 *   block editor context. Hooking into the front-end enqueue hook instead
	 *   would load the 400KB+ preview bundle on every published page that contains
	 *   the block — a site-wide performance regression and a violation of the
	 *   PERF-01 / Pitfall 5 constraint. The view bundle (khaveeai-bundle.js) stays
	 *   on the Phase-8 AssetManager::enqueue() path called from
	 *   AvatarRenderer::render() and is untouched by this method.
	 *
	 * Why the dependency array is empty (D-10 full isolation):
	 *   The preview bundle is an IIFE that bundles its own copy of React 19 and
	 *   React Three Fiber. It must NOT be wired to wp-element (WP's copy of
	 *   React 18) or any other WordPress script handle — a version mismatch would
	 *   silently break the 3D canvas.
	 *
	 * STUDIO-02 safety:
	 *   The preview bundle's import graph structurally excludes
	 *   OpenAIRealtimeProvider (no getUserMedia, no /wp-json/khaveeai/v1/session
	 *   call). The build-time grep assertion in packages/wp-bundle/build.mjs
	 *   enforces this at build time; the Phase-9 UAT Step 3 confirms it
	 *   behaviourally in a live browser.
	 *
	 * @return void
	 */
	public static function register_preview_bundle(): void {
		if ( wp_script_is( 'khaveeai-preview', 'registered' ) ) {
			return;
		}

		$preview_path = plugin_dir_path( KHAVEEAI_PLUGIN_FILE ) . 'build/khaveeai-preview.js';
		$version      = file_exists( $preview_path ) ? (string) filemtime( $preview_path ) : KHAVEEAI_VERSION;

		wp_register_script(
			'khaveeai-preview',
			plugins_url( 'build/khaveeai-preview.js', KHAVEEAI_PLUGIN_FILE ),
			array(), // D-10 full isolation — bundle owns its own React 19.
			$version,
			false
		);

		// Expose the admin's resolved global config to the editor as
		// window.khaveeaiGlobalConfig, so the block sidebar's "Global
		// default / Custom" toggle (260704-05c) can show the REAL currently
		// resolved value instead of a stale hardcoded string — get_runtime_config()
		// already reflects a connected Khavee Platform key's overlay when one
		// is set. This is a read-only, already-cached (5-min transient) call:
		// no new per-editor-page network cost beyond what the admin settings
		// page's own connection notice already triggers. get_runtime_config()
		// is proven secret-free (platform-config-harness.php asserts no
		// sentinel/secret ever appears in its output) — the platform/OpenAI
		// keys live only behind the separate get_api_key() method, which is
		// never localized here.
		wp_localize_script(
			'khaveeai-preview',
			'khaveeaiGlobalConfig',
			( new PlatformConfigSource( new WpOptionsConfigSource() ) )->get_runtime_config()
		);

		// Companion stylesheet (khaveeai-preview.css, esbuild's CSS output for
		// preview.ts's `import "../styles.css"`) — registered here, referenced
		// by handle from block.json's "editorStyle" (mirrors "khaveeai-preview"
		// above for editorScript). Without this, the .khaveeai-chat/-layout
		// rules the Chat Box preview relies on never load in the editor, so
		// the chat panel renders unstyled and overlapping the avatar canvas
		// instead of positioned beside/below it (found while adding the
		// preview Chat Box, 2026-07-02).
		$style_path    = plugin_dir_path( KHAVEEAI_PLUGIN_FILE ) . 'build/khaveeai-preview.css';
		$style_version = file_exists( $style_path ) ? (string) filemtime( $style_path ) : KHAVEEAI_VERSION;

		wp_register_style(
			'khaveeai-preview-style',
			plugins_url( 'build/khaveeai-preview.css', KHAVEEAI_PLUGIN_FILE ),
			array(),
			$style_version
		);
	}

	/**
	 * wp_footer callback: echo the site-wide floating chat launcher's mount
	 * point (FLOAT-01, quick task 260704-77n), gated on the persisted
	 * "Enable floating widget" setting. Renders on every front-end page
	 * regardless of whether any shortcode/block instance also exists on
	 * that page — this is the whole point of the feature (site-wide,
	 * block-independent).
	 *
	 * Guards, in order:
	 *  1. is_admin() — defense-in-depth (T-77n-03); wp_footer itself never
	 *     fires in wp-admin, but this makes the front-end-only guarantee
	 *     independent of that hook's own scope.
	 *  2. Once-guard — at most one mount point per page load (T-77n-04).
	 *  3. The persisted `floating_widget_enabled` setting — off by default.
	 *  4. self::$floating_renderer must be set (boot() always sets it before
	 *     wp_footer can fire, but this guards against any out-of-order call).
	 *
	 * @return void
	 */
	public static function render_floating_widget(): void {
		if ( is_admin() ) {
			return;
		}

		if ( self::$floating_widget_rendered ) {
			return;
		}

		$settings = get_option( 'khaveeai_settings', array() );
		$settings = is_array( $settings ) ? $settings : array();

		if ( empty( $settings['floating_widget_enabled'] ) ) {
			return;
		}

		if ( null === self::$floating_renderer ) {
			return;
		}

		self::$floating_widget_rendered = true;

		// Already escaped inside render_floating() — echo verbatim, same
		// convention as AvatarShortcode/AvatarBlock consuming render().
		echo self::$floating_renderer->render_floating(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- render_floating() returns pre-escaped markup (esc_attr on the JSON config), matching render()'s own convention.
	}
}
