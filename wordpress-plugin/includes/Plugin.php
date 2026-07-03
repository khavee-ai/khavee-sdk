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

		$shortcode = new AvatarShortcode( $renderer );
		$shortcode->register();

		$block = new AvatarBlock( $renderer );
		add_action( 'init', array( $block, 'register' ) );

		// Phase 9: register khaveeai-preview so block.json's editorScript array
		// can reference it by handle. Registration runs in init (priority 9, before
		// AvatarBlock::register at priority 10) so the handle exists when
		// register_block_type resolves the editorScript list.
		// The script is editor-only: block.json lists it in "editorScript" (not
		// "script" / "viewScript"), so WordPress loads it only inside the Gutenberg
		// block-canvas iframe — never on published pages (Pitfall 5 / PERF-01).
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
	}
}
