<?php
/**
 * wp_options-backed ConfigSourceInterface implementation.
 *
 * @package Khavee\Plugin\ConfigSource
 */

namespace Khavee\Plugin\ConfigSource;

/**
 * Reads the admin-configured settings blob from wp_options.
 *
 * This class performs no sanitization itself on read: it trusts the writer
 * (Admin\SettingsPage) to have already sanitized/validated the blob before
 * update_option() is called. The avatar is stored as a Media Library
 * attachment ID and resolved to a URL via wp_get_attachment_url() at read
 * time (Pattern 3), so wp_options never holds a pre-resolved URL string
 * and Media Library URL changes (CDN migration, multisite) require no
 * settings re-save.
 */
final class WpOptionsConfigSource implements ConfigSourceInterface {

	/**
	 * Option name the settings blob is stored under.
	 *
	 * @var string
	 */
	private const OPTION_NAME = 'khaveeai_settings';

	/**
	 * Default instructions when the option is unset or empty.
	 *
	 * Matches OpenAIRealtimeProvider.ts:144's default system instructions.
	 *
	 * @var string
	 */
	private const DEFAULT_INSTRUCTIONS = 'You are a helpful AI assistant.';

	/**
	 * Default voice when the option is unset or empty.
	 *
	 * @var string
	 */
	private const DEFAULT_VOICE = 'alloy';

	/**
	 * Default model when the option is unset or empty.
	 *
	 * Matches OpenAIRealtimeProvider.ts:142's default model.
	 *
	 * @var string
	 */
	private const DEFAULT_MODEL = 'gpt-realtime-1.5';

	/**
	 * Default ambient/directional light intensity for the 3D scene.
	 * Matches Phase-8 mount.tsx:59 hardcoded value.
	 *
	 * @var float
	 */
	private const DEFAULT_LIGHT_INTENSITY = 1.0;

	/**
	 * Default avatar scale multiplier (1.0 = natural size).
	 *
	 * @var float
	 */
	private const DEFAULT_AVATAR_SCALE = 1.0;

	/**
	 * Default horizontal avatar offset in scene units (0.0 = centred).
	 *
	 * @var float
	 */
	private const DEFAULT_AVATAR_OFFSET_X = 0.0;

	/**
	 * Default vertical avatar offset in scene units (0.0 = centred).
	 *
	 * @var float
	 */
	private const DEFAULT_AVATAR_OFFSET_Y = 0.0;

	/**
	 * Default camera preset key.
	 * Must match a key in CAMERA_PRESETS (packages/wp-bundle/src/config.ts).
	 *
	 * @var string
	 */
	private const DEFAULT_CAMERA_PRESET = 'front';

	/**
	 * Default chat panel placement relative to the avatar canvas.
	 *
	 * @var string
	 */
	private const DEFAULT_CHAT_PLACEMENT = 'beside';

	/**
	 * Default camera horizontal orbit angle, in degrees, applied on top of
	 * the selected camera preset's base position (0 = preset's own angle).
	 *
	 * @var float
	 */
	private const DEFAULT_CAMERA_ROTATION_Y = 0.0;

	/**
	 * {@inheritDoc}
	 */
	public function get_runtime_config(): array {
		$settings = get_option( self::OPTION_NAME, [] );

		if ( ! is_array( $settings ) ) {
			$settings = [];
		}

		$instructions    = isset( $settings['instructions'] ) ? (string) $settings['instructions'] : '';
		$voice           = isset( $settings['voice'] ) ? (string) $settings['voice'] : '';
		$model           = isset( $settings['model'] ) ? (string) $settings['model'] : '';
		$attachment_id   = isset( $settings['avatar_attachment_id'] ) ? (int) $settings['avatar_attachment_id'] : 0;
		$avatar_url      = $attachment_id > 0 ? wp_get_attachment_url( $attachment_id ) : ''; // (D-13, Pattern 3) resolve attachment ID -> URL at read time.
		$avatar_url      = is_string( $avatar_url ) ? $avatar_url : ''; // wp_get_attachment_url() returns false on an invalid ID — coerce to '' so the return shape stays avatar_url: string (T-07A-02).

		return [
			'instructions'   => '' !== $instructions ? $instructions : self::DEFAULT_INSTRUCTIONS,
			'voice'          => '' !== $voice ? $voice : self::DEFAULT_VOICE,
			'avatar_url'     => $avatar_url,
			'model'          => '' !== $model ? $model : self::DEFAULT_MODEL,
			// Phase-9 visual/chat config defaults (STUDIO-05).
			// Admin settings-page UI for editing these is out of scope this phase
			// (CONTEXT <deferred_ideas>); only the defaults must exist so
			// wp_parse_args() in AvatarRenderer::render() has a fallback for every key.
			'container_width'  => isset( $settings['container_width'] )  ? (int)    $settings['container_width']  : 0,
			'container_height' => isset( $settings['container_height'] ) ? (int)    $settings['container_height'] : 0,
			'full_width'       => isset( $settings['full_width'] )       ? (bool)   $settings['full_width']       : false,
			'bg_type'          => isset( $settings['bg_type'] )          ? (string) $settings['bg_type']          : '',
			'bg_color'         => isset( $settings['bg_color'] )         ? (string) $settings['bg_color']         : '',
			'bg_transparent'   => isset( $settings['bg_transparent'] )   ? (bool)   $settings['bg_transparent']   : false,
			// bg_image_url is resolved per-instance from bgImageId in AvatarBlock.php;
			// there is no meaningful global admin default for a URL — empty string causes
			// AvatarRenderer::public_safe() to emit '' which the bundle treats as "no background image".
			'bg_image_url'     => '',
			'light_intensity'  => isset( $settings['light_intensity'] )  ? (float)  $settings['light_intensity']  : self::DEFAULT_LIGHT_INTENSITY,
			'avatar_scale'     => isset( $settings['avatar_scale'] )     ? (float)  $settings['avatar_scale']     : self::DEFAULT_AVATAR_SCALE,
			'avatar_offset_x'  => isset( $settings['avatar_offset_x'] )  ? (float)  $settings['avatar_offset_x']  : self::DEFAULT_AVATAR_OFFSET_X,
			'avatar_offset_y'  => isset( $settings['avatar_offset_y'] )  ? (float)  $settings['avatar_offset_y']  : self::DEFAULT_AVATAR_OFFSET_Y,
			'camera_preset'    => isset( $settings['camera_preset'] )    ? (string) $settings['camera_preset']    : self::DEFAULT_CAMERA_PRESET,
			'camera_rotation_y' => isset( $settings['camera_rotation_y'] ) ? (float) $settings['camera_rotation_y'] : self::DEFAULT_CAMERA_ROTATION_Y,
			'chat_show'        => isset( $settings['chat_show'] )        ? (bool)   $settings['chat_show']        : false,
			'chat_placement'   => isset( $settings['chat_placement'] )   ? (string) $settings['chat_placement']   : self::DEFAULT_CHAT_PLACEMENT,
			// Floating-widget-only visual config (quick task 260705-p30) —
			// independent of the global bg_color/bg_transparent/avatar_scale/
			// avatar_offset_x/y keys above; the floating panel never falls
			// back to those, only to these floating_*-prefixed defaults.
			'floating_bg_color'        => isset( $settings['floating_bg_color'] )        ? (string) $settings['floating_bg_color']        : '',
			'floating_bg_transparent'  => isset( $settings['floating_bg_transparent'] )  ? (bool)   $settings['floating_bg_transparent']  : false,
			'floating_avatar_offset_x' => isset( $settings['floating_avatar_offset_x'] ) ? (float)  $settings['floating_avatar_offset_x'] : 0.0,
			'floating_avatar_offset_y' => isset( $settings['floating_avatar_offset_y'] ) ? (float)  $settings['floating_avatar_offset_y'] : 0.0,
			'floating_avatar_scale'    => isset( $settings['floating_avatar_scale'] )    ? (float)  $settings['floating_avatar_scale']    : 1.0,
			'floating_camera_rotation_y' => isset( $settings['floating_camera_rotation_y'] ) ? (float) $settings['floating_camera_rotation_y'] : self::DEFAULT_CAMERA_ROTATION_Y,
		];
	}

	/**
	 * {@inheritDoc}
	 */
	public function get_api_key(): string {
		$settings = get_option( self::OPTION_NAME, [] );

		if ( ! is_array( $settings ) || ! isset( $settings['api_key'] ) ) {
			return '';
		}

		return (string) $settings['api_key'];
	}

	/**
	 * {@inheritDoc}
	 *
	 * Composed over get_api_key() so there is exactly one place that decides
	 * what counts as "configured" (D-12): a non-empty key. A wrong/revoked
	 * key is NOT detected here — only emptiness — matching the project's
	 * existing "surface real failures via the runtime REST error path, not
	 * via client-side format heuristics" discipline.
	 */
	public function is_configured(): bool {
		return '' !== $this->get_api_key();
	}
}
