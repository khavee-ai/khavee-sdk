<?php
/**
 * AvatarBlock — the `khaveeai/avatar` Gutenberg block adapter (EMBED-03).
 *
 * @package Khavee\Plugin\Block
 */

namespace Khavee\Plugin\Block;

use Khavee\Plugin\Render\AvatarRenderer;

/**
 * Thin adapter: registers the block from this directory's block.json and
 * delegates render_callback() to the SAME shared AvatarRenderer the
 * shortcode uses, so the block and shortcode cannot drift (EMBED-04).
 *
 * render_callback() is also the editor preview source — @wordpress/server-side-render
 * calls it via the REST block-renderer endpoint, so the Gutenberg editor
 * never mounts the live SPA, never opens a mic prompt, and never mints a
 * real OpenAI token while editing (EMBED-05).
 */
final class AvatarBlock {

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
	 * Register the `khaveeai/avatar` block type. Auto-discovers block.json
	 * from this directory.
	 *
	 * @return void
	 */
	public function register(): void {
		register_block_type(
			__DIR__,
			array(
				'render_callback' => array( $this, 'render_callback' ),
			)
		);
	}

	/**
	 * Block render callback. Block attributes arrive already-typed per
	 * block.json's schema (no shortcode_atts()-style normalization
	 * needed), but empty-string/zero values are still filtered out before
	 * merge — the SAME normalization AvatarShortcode::render() performs —
	 * so the block and shortcode produce identical output for identical
	 * inputs (EMBED-04). The `avatar` attribute is a Media Library
	 * attachment ID (same as the shortcode's `avatar` attribute), resolved
	 * to a URL here before delegating, so AvatarRenderer never needs to
	 * know whether `avatar_url` came from a shortcode or a block.
	 *
	 * Never echoes get_api_key() or any secret — delegates entirely to
	 * AvatarRenderer, which already enforces public_safe().
	 *
	 * @param array $attributes Block attributes (voice, instructions, avatar).
	 * @return string
	 */
	public function render_callback( array $attributes ): string {
		$attachment_id = isset( $attributes['avatar'] ) ? (int) $attributes['avatar'] : 0;
		$avatar_url    = $attachment_id > 0 ? wp_get_attachment_url( $attachment_id ) : '';
		$avatar_url    = is_string( $avatar_url ) ? $avatar_url : '';

		$renderer_atts = array(
			'voice'        => isset( $attributes['voice'] ) ? (string) $attributes['voice'] : '',
			'instructions' => isset( $attributes['instructions'] ) ? (string) $attributes['instructions'] : '',
			'avatar_url'   => $avatar_url,
		);

		$renderer_atts = array_filter( $renderer_atts, static fn( $v ) => '' !== $v );

		return $this->renderer->render( $renderer_atts );
	}
}
