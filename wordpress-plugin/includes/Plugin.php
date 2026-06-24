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
	}
}
