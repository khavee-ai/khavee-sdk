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
	 * The `bgImageId` attribute (Phase 9, STUDIO-05) is resolved to a URL
	 * in the same way: cast to int, verified > 0, then resolved via
	 * wp_get_attachment_url() — no user-supplied URL string is ever accepted
	 * (T-09-01-02 mitigates SSRF/path-traversal risk).
	 *
	 * Never echoes get_api_key() or any secret — delegates entirely to
	 * AvatarRenderer, which already enforces public_safe().
	 *
	 * @param array $attributes Block attributes (voice, instructions, avatar, + Phase-9 visual/chat keys).
	 * @return string
	 */
	public function render_callback( array $attributes ): string {
		$attachment_id = isset( $attributes['avatar'] ) ? (int) $attributes['avatar'] : 0;
		$avatar_url    = $attachment_id > 0 ? wp_get_attachment_url( $attachment_id ) : '';
		$avatar_url    = is_string( $avatar_url ) ? $avatar_url : '';

		// Phase-9: resolve bgImageId → URL exactly as `avatar` is resolved above
		// (T-09-01-02 — only Media Library IDs accepted, no user-supplied URL strings).
		$bg_image_url = isset( $attributes['bgImageId'] ) && $attributes['bgImageId'] > 0
			? wp_get_attachment_url( (int) $attributes['bgImageId'] ) : '';
		$bg_image_url = is_string( $bg_image_url ) ? $bg_image_url : '';

		$renderer_atts = array(
			'voice'           => isset( $attributes['voice'] )        ? (string) $attributes['voice']        : '',
			'instructions'    => isset( $attributes['instructions'] ) ? (string) $attributes['instructions'] : '',
			'avatar_url'      => $avatar_url,
			// Phase-9 visual/chat config keys (STUDIO-05).
			// Numeric keys default to their "real" defaults here (not 0) because a
			// block attribute value of 0 means "use admin default" — the attribute
			// schema uses 0 as the sentinel, and the render_callback applies the
			// real default so wp_parse_args receives a meaningful value to merge.
			'container_width'  => isset( $attributes['containerWidth'] )  ? (int)    $attributes['containerWidth']  : 0,
			'container_height' => isset( $attributes['containerHeight'] ) ? (int)    $attributes['containerHeight'] : 0,
			'full_width'       => ! empty( $attributes['fullWidth'] ),
			'bg_type'          => isset( $attributes['bgType'] )          ? (string) $attributes['bgType']         : '',
			'bg_color'         => isset( $attributes['bgColor'] )         ? (string) $attributes['bgColor']        : '',
			'bg_transparent'   => ! empty( $attributes['bgTransparent'] ),
			'bg_image_url'     => $bg_image_url,
			// isset() is wrong here (unlike containerWidth/Height above, where 0 IS
			// the real desired fallback): Gutenberg ALWAYS populates lightIntensity/
			// avatarScale with their block.json schema default (0) even when the
			// author never touched the control, so isset() is true and the "real"
			// default (1.0) below was never actually reached — every block that
			// hadn't had these two sliders explicitly dragged rendered with
			// avatarScale=0 (invisible avatar) and lightIntensity=0 (unlit) on the
			// published page (found 2026-07-02, reported as "camera rotation doesn't
			// affect the real page" — nothing was visible to rotate). `> 0` matches
			// the same "0 means unset" convention editor.js's RangeControl display
			// already uses (`value: live.avatarScale > 0 ? ... : undefined`).
			'light_intensity'  => ( $attributes['lightIntensity'] ?? 0 ) > 0  ? (float)  $attributes['lightIntensity']  : 1.0,
			'avatar_scale'     => ( $attributes['avatarScale'] ?? 0 ) > 0     ? (float)  $attributes['avatarScale']     : 1.0,
			'avatar_offset_x'  => isset( $attributes['avatarOffsetX'] )   ? (float)  $attributes['avatarOffsetX']   : 0.0,
			'avatar_offset_y'  => isset( $attributes['avatarOffsetY'] )   ? (float)  $attributes['avatarOffsetY']   : 0.0,
			'camera_preset'    => isset( $attributes['cameraPreset'] )    ? (string) $attributes['cameraPreset']    : '',
			'camera_rotation_y' => isset( $attributes['cameraRotationY'] ) ? (float) $attributes['cameraRotationY'] : 0.0,
			'chat_show'        => ! empty( $attributes['chatShow'] ),
			'chat_placement'   => isset( $attributes['chatPlacement'] )   ? (string) $attributes['chatPlacement']   : '',
		);

		// SAFE FILTER (T-09-01-03): the original `static fn( $v ) => '' !== $v` would
		// strip numeric 0 / 0.0 and false under PHP loose comparison (`'' == 0` is true).
		// This type-aware callback preserves non-string values so scale=0 or offset=0
		// survive the filter and correctly override the admin default via wp_parse_args.
		$renderer_atts = array_filter(
			$renderer_atts,
			static function ( $v, $k ) {
				if ( is_string( $v ) ) {
					return '' !== $v;
				}
				return true; // keep numeric + bool as-is (preserves 0, 0.0, false)
			},
			ARRAY_FILTER_USE_BOTH
		);

		return $this->renderer->render( $renderer_atts );
	}
}
