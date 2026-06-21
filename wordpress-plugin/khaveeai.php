<?php
/**
 * Plugin Name: Khavee AI Avatar
 * Plugin URI: https://khavee.ai
 * Description: Embed a self-configured, voice-chat VRM avatar on any WordPress page — no dependency on the hosted Khavee platform.
 * Version: 0.1.0
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
// Guarded by file_exists() so this bootstrap still lints/loads cleanly before
// `composer install` has been run (e.g. during CI lint checks or a fresh checkout).
$khaveeai_autoloader = __DIR__ . '/vendor/autoload.php';
if ( file_exists( $khaveeai_autoloader ) ) {
	require $khaveeai_autoloader;
}

// Boot the composition root on plugins_loaded — after the autoload
// require above, so the SessionController instance it constructs is
// ready before WordPress fires rest_api_init.
add_action( 'plugins_loaded', array( '\\Khavee\\Plugin\\Plugin', 'boot' ) );
