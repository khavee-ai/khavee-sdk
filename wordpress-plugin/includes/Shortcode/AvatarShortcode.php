<?php
/**
 * AvatarShortcode — the `[khaveeai_avatar]` adapter (EMBED-01).
 *
 * @package Khavee\Plugin\Shortcode
 */

namespace Khavee\Plugin\Shortcode;

use Khavee\Plugin\Render\AvatarRenderer;

/**
 * Thin adapter: normalizes WP shortcode attributes and delegates to the
 * shared AvatarRenderer so the shortcode and the Gutenberg block cannot
 * drift (EMBED-04).
 */
final class AvatarShortcode {

	/**
	 * @var AvatarRenderer
	 */
	private $renderer;

	/**
	 * @param AvatarRenderer $renderer
	 */
	public function __construct( AvatarRenderer $renderer ) {
		$this->renderer = $renderer;
	}

	/**
	 * Register the `[khaveeai_avatar]` shortcode.
	 *
	 * @return void
	 */
	public function register(): void {
		add_shortcode( 'khaveeai_avatar', array( $this, 'render' ) );
	}

	/**
	 * Shortcode callback. Normalizes attributes via shortcode_atts(),
	 * strips empty-string values (so an omitted attribute falls back to
	 * the global default rather than overriding it with ''), then
	 * delegates to AvatarRenderer::render().
	 *
	 * @param array|string $atts Raw shortcode attributes as passed by WP.
	 * @return string
	 */
	public function render( $atts ): string {
		$atts = shortcode_atts(
			array(
				'voice'        => '',
				'instructions' => '',
				'avatar'       => '',
			),
			(array) $atts,
			'khaveeai_avatar'
		);

		$atts = array_filter( $atts, static fn( $v ) => '' !== $v );

		return $this->renderer->render( $atts );
	}
}
