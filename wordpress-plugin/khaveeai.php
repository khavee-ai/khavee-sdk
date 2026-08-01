<?php
/**
 * Plugin Name: Khavee AI Avatar
 * Plugin URI: https://khavee.ai
 * Description: Embed a self-configured, voice-chat VRM avatar on any WordPress page — no dependency on the hosted Khavee platform.
 * Version: 0.6.1
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * Author: Khavee
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: khaveeai
 *
 * @package Khavee\Plugin
 */

// Prevent direct access — this file must only ever be loaded by WordPress (T-06-02).
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Composer PSR-4 autoload map: Khavee\Plugin\ => includes/.
// vendor/ is gitignored (regenerable, never committed) — a fresh checkout
// or zip distribution will not have it until `composer install` is run
// inside this directory. Fail gracefully here (admin notice + early
// return) rather than registering plugins_loaded against an undefined
// \Khavee\Plugin\Plugin class, which would fatal-error the entire site
// (CR-02) — not just this plugin's feature.
$khaveeai_autoloader = __DIR__ . '/vendor/autoload.php';
if ( ! file_exists( $khaveeai_autoloader ) ) {
	add_action(
		'admin_notices',
		function () {
			echo '<div class="notice notice-error"><p>' .
				esc_html__( 'Khavee AI Avatar is installed but inactive: missing Composer dependencies. Run "composer install" inside the plugin directory (wp-content/plugins/wordpress-plugin), then reload this page.', 'khaveeai' ) .
				'</p></div>';
		}
	);
	return;
}

require $khaveeai_autoloader;

// Constants AssetManager (Phase 8) depends on to enqueue the front-end
// bundle relative to this file and bust the cache on version bumps.
if ( ! defined( 'KHAVEEAI_PLUGIN_FILE' ) ) {
	define( 'KHAVEEAI_PLUGIN_FILE', __FILE__ );
}
if ( ! defined( 'KHAVEEAI_VERSION' ) ) {
	define( 'KHAVEEAI_VERSION', '0.1.0' );
}

// Boot the composition root on plugins_loaded — after the autoload
// require above, so the SessionController instance it constructs is
// ready before WordPress fires rest_api_init.
add_action( 'plugins_loaded', array( '\\Khavee\\Plugin\\Plugin', 'boot' ) );
