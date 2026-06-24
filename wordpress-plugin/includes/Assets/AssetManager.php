<?php
/**
 * AssetManager — render-path-triggered, idempotent enqueue of the
 * front-end avatar bundle (PERF-01).
 *
 * @package Khavee\Plugin\Assets
 */

namespace Khavee\Plugin\Assets;

/**
 * Standalone, constructor-free utility class mirroring RateLimiter's
 * shape: all WP-function usage is narrow enough to stub in a bare-PHP
 * harness.
 *
 * enqueue() is deliberately NEVER hooked to `wp_enqueue_scripts` — it is
 * called only from inside AvatarRenderer::render(), so the bundle loads
 * exclusively on pages that actually render a shortcode/block instance,
 * never site-wide (PERF-01, RESEARCH Pitfall 2).
 */
final class AssetManager {

	/**
	 * Script handle for the front-end avatar bundle.
	 *
	 * @var string
	 */
	const HANDLE = 'khaveeai-bundle';

	/**
	 * Style handle for the front-end avatar bundle's CSS.
	 *
	 * @var string
	 */
	const STYLE_HANDLE = 'khaveeai-bundle-style';

	/**
	 * Enqueue the bundle script + stylesheet, exactly once regardless of
	 * how many shortcode/block instances call this on the same page.
	 *
	 * The dependency array passed to wp_enqueue_script() is deliberately
	 * empty: the bundle owns its own bundled React copy and must not be
	 * wired to WP core's `wp-element`/React build (D-10 full isolation).
	 *
	 * @return void
	 */
	public function enqueue(): void {
		if ( wp_script_is( self::HANDLE, 'enqueued' ) ) {
			return; // Idempotent — N instances on one page enqueue once.
		}

		$bundle_path = plugin_dir_path( KHAVEEAI_PLUGIN_FILE ) . 'build/khaveeai-bundle.js';
		$style_path  = plugin_dir_path( KHAVEEAI_PLUGIN_FILE ) . 'build/khaveeai-bundle.css';

		$version = file_exists( $bundle_path ) ? (string) filemtime( $bundle_path ) : KHAVEEAI_VERSION;

		wp_enqueue_script(
			self::HANDLE,
			plugins_url( 'build/khaveeai-bundle.js', KHAVEEAI_PLUGIN_FILE ),
			array(), // Deliberately empty — bundle is fully self-contained (D-10).
			$version,
			array( 'in_footer' => true )
		);

		$style_version = file_exists( $style_path ) ? (string) filemtime( $style_path ) : KHAVEEAI_VERSION;

		wp_enqueue_style(
			self::STYLE_HANDLE,
			plugins_url( 'build/khaveeai-bundle.css', KHAVEEAI_PLUGIN_FILE ),
			array(),
			$style_version
		);
	}
}
