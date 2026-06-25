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

		$config_source  = new WpOptionsConfigSource();
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
	}
}
