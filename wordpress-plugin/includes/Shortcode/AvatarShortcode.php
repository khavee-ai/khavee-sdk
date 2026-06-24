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
	 * resolves the `avatar` Media Library attachment ID to a URL (D-03 —
	 * the shortcode attribute is an attachment ID, not a raw URL, the
	 * same as WpOptionsConfigSource's global avatar storage), strips
	 * empty-string values (so an omitted attribute falls back to the
	 * global default rather than overriding it with ''), then delegates
	 * to AvatarRenderer::render() using the SAME `avatar_url` key the
	 * renderer's merge/fallback logic expects — this is the exact seam
	 * EMBED-04 requires: the renderer never knows whether `avatar_url`
	 * came from a shortcode attachment-ID resolution or an
	 * already-resolved block attribute.
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

		$attachment_id = (int) $atts['avatar'];
		$avatar_url    = $attachment_id > 0 ? wp_get_attachment_url( $attachment_id ) : '';
		$avatar_url    = is_string( $avatar_url ) ? $avatar_url : '';

		$renderer_atts = array(
			'voice'        => $atts['voice'],
			'instructions' => $atts['instructions'],
			'avatar_url'   => $avatar_url,
		);

		$renderer_atts = array_filter( $renderer_atts, static fn( $v ) => '' !== $v );

		return $this->renderer->render( $renderer_atts );
	}
}
