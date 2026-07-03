<?php
/**
 * AvatarRenderer — the single shared render path both the shortcode and
 * the Gutenberg block funnel through (EMBED-04).
 *
 * @package Khavee\Plugin\Render
 */

namespace Khavee\Plugin\Render;

use Khavee\Plugin\ConfigSource\ConfigSourceInterface;
use Khavee\Plugin\Assets\AssetManager;

/**
 * Merges instance attributes over the admin-configured global defaults,
 * enqueues the front-end bundle (PERF-01), and emits an XSS-safe
 * mount-point div carrying the merged config as escaped JSON.
 *
 * Also owns the D-06/D-07 not-configured branch: an admin sees an inline
 * notice; a non-admin/logged-out visitor sees a neutral inert
 * placeholder with no notice markup present in the returned string at
 * all (not merely CSS-hidden).
 */
final class AvatarRenderer {

	/**
	 * @var ConfigSourceInterface
	 */
	private $config_source;

	/**
	 * @var AssetManager
	 */
	private $assets;

	/**
	 * @param ConfigSourceInterface $config_source
	 * @param AssetManager          $assets
	 */
	public function __construct( ConfigSourceInterface $config_source, AssetManager $assets ) {
		$this->config_source = $config_source;
		$this->assets        = $assets;
	}

	/**
	 * Render one avatar instance (shortcode or block — both call this).
	 *
	 * @param array $atts Instance-level attribute overrides. Empty-string/
	 *                     zero values are treated as "omitted" and never
	 *                     override the global default for that field.
	 * @return string HTML markup: either the mount-point div, the D-06
	 *                 admin notice, or the D-07 visitor placeholder.
	 */
	public function render( array $atts ): string {
		$defaults = $this->config_source->get_runtime_config();

		// Instance atts win over defaults — wp_parse_args() merges $atts
		// OVER $defaults (first arg wins on key collision).
		$merged = wp_parse_args( $atts, $defaults );

		// Defensive isset->cast->fallback re-application per field, mirroring
		// WpOptionsConfigSource's own merge shape — guards against an empty
		// string surviving wp_parse_args() for a field present in $atts but
		// blank (callers are expected to array_filter() these out already,
		// but AvatarRenderer must not trust that has happened).
		$instructions = isset( $merged['instructions'] ) ? (string) $merged['instructions'] : '';
		$voice        = isset( $merged['voice'] ) ? (string) $merged['voice'] : '';
		$avatar_url   = isset( $merged['avatar_url'] ) ? (string) $merged['avatar_url'] : '';
		$model        = isset( $merged['model'] ) ? (string) $merged['model'] : '';

		$merged['instructions'] = '' !== $instructions ? $instructions : (string) $defaults['instructions'];
		$merged['voice']        = '' !== $voice ? $voice : (string) $defaults['voice'];
		$merged['avatar_url']   = '' !== $avatar_url ? $avatar_url : (string) $defaults['avatar_url'];
		$merged['model']        = '' !== $model ? $model : (string) $defaults['model'];

		// Phase-9 visual/chat config — defensive re-application of the 13 new keys
		// (mirrors the existing 4-key block above; same rationale: AvatarRenderer must
		// not trust that callers have already array_filter'd blank overrides).
		$merged['container_width']  = isset( $merged['container_width'] )  ? (int)    $merged['container_width']  : 0;
		$merged['container_height'] = isset( $merged['container_height'] ) ? (int)    $merged['container_height'] : 0;
		$merged['full_width']       = (bool) ( $merged['full_width'] ?? false );
		$merged['bg_type']          = isset( $merged['bg_type'] )          ? (string) $merged['bg_type']          : '';
		$merged['bg_color']         = isset( $merged['bg_color'] )         ? (string) $merged['bg_color']         : '';
		$merged['bg_transparent']   = (bool) ( $merged['bg_transparent'] ?? false );
		$merged['bg_image_url']     = isset( $merged['bg_image_url'] )     ? (string) $merged['bg_image_url']     : '';
		// `> 0`, not isset(): 0 is the "unset" sentinel for these two fields
		// (their real default is 1.0), unlike container_width/height where 0
		// IS the real fallback — see AvatarBlock.php's render_callback for
		// the full explanation of the isset()-always-true bug this avoids.
		$merged['light_intensity']  = ( $merged['light_intensity'] ?? 0 ) > 0  ? (float)  $merged['light_intensity']  : 1.0;
		$merged['avatar_scale']     = ( $merged['avatar_scale'] ?? 0 ) > 0     ? (float)  $merged['avatar_scale']     : 1.0;
		$merged['avatar_offset_x']  = isset( $merged['avatar_offset_x'] )  ? (float)  $merged['avatar_offset_x']  : 0.0;
		$merged['avatar_offset_y']  = isset( $merged['avatar_offset_y'] )  ? (float)  $merged['avatar_offset_y']  : 0.0;
		$merged['camera_preset']    = isset( $merged['camera_preset'] ) && '' !== $merged['camera_preset']
			? (string) $merged['camera_preset'] : 'front';
		$merged['camera_rotation_y'] = isset( $merged['camera_rotation_y'] ) ? (float) $merged['camera_rotation_y'] : 0.0;
		$merged['chat_show']        = (bool) ( $merged['chat_show'] ?? false );
		$merged['chat_placement']   = isset( $merged['chat_placement'] ) && '' !== $merged['chat_placement']
			? (string) $merged['chat_placement'] : 'beside';

		if ( ! $this->config_source->is_configured() ) {
			if ( current_user_can( 'manage_options' ) ) {
				return $this->render_admin_notice();
			}

			return $this->render_visitor_placeholder();
		}

		// Configured path: enqueue assets only from here (PERF-01) and emit
		// the escaped mount point.
		$this->assets->enqueue();

		$id = 'khaveeai-' . wp_unique_id();

		return sprintf(
			'<div id="%s" class="khaveeai-root" data-khaveeai-config="%s"></div>',
			esc_attr( $id ),
			esc_attr( wp_json_encode( $this->public_safe( $merged ) ) )
		);
	}

	/**
	 * D-06: admin-only "not configured" notice. Reached ONLY when the
	 * caller has already confirmed current_user_can('manage_options') —
	 * this method must never be called for a non-admin.
	 *
	 * @return string
	 */
	private function render_admin_notice(): string {
		$settings_url = admin_url( 'admin.php?page=khaveeai-settings' );

		return sprintf(
			'<div class="khaveeai-root notice notice-warning"><p><strong>%s</strong><br />%s <a href="%s">%s</a></p></div>',
			esc_html__( "Khavee AI Avatar isn't configured yet", 'khaveeai' ),
			esc_html__( 'Add your OpenAI API key in Settings to activate this avatar for visitors.', 'khaveeai' ),
			esc_url( $settings_url ),
			esc_html__( 'Go to Settings', 'khaveeai' )
		);
	}

	/**
	 * D-07: neutral inert placeholder for a logged-out visitor or any
	 * non-admin user. No notice text, no error — must read as visually
	 * inert, not as a message.
	 *
	 * @return string
	 */
	private function render_visitor_placeholder(): string {
		return '<div class="khaveeai-root khaveeai-placeholder" role="img" aria-label="' .
			esc_attr__( 'AI avatar placeholder', 'khaveeai' ) .
			'"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="4"></circle><path d="M4 20c0-4.418 3.582-8 8-8s8 3.582 8 8"></path></svg></div>';
	}

	/**
	 * Whitelist the merged config down to exactly the keys safe to expose
	 * in the front-end mount point. NEVER includes the API key — this
	 * method does not, and must never, read the secret credential from
	 * ConfigSourceInterface.
	 *
	 * All new Phase-9 keys (bgColor, bgImageUrl, cameraPreset, etc.) pass
	 * through the existing `esc_attr( wp_json_encode( ... ) )` at the call
	 * site — JSON-encoding plus attribute escaping defeats any XSS attempt
	 * (T-09-01-01). Each key is also cast to its primitive type before
	 * arriving here, preventing arbitrary string injection.
	 *
	 * @param array $merged Merged instance+global config.
	 * @return array
	 */
	private function public_safe( array $merged ): array {
		return array(
			// Phase-8 keys (unchanged):
			'voice'           => isset( $merged['voice'] )        ? (string) $merged['voice']        : '',
			'instructions'    => isset( $merged['instructions'] ) ? (string) $merged['instructions'] : '',
			'avatarUrl'       => isset( $merged['avatar_url'] )   ? (string) $merged['avatar_url']   : '',
			'model'           => isset( $merged['model'] )        ? (string) $merged['model']        : '',
			'restUrl'         => rest_url( 'khaveeai/v1/session' ),
			// Phase-9 visual/chat config keys (STUDIO-05, snake→camel translation boundary):
			'containerWidth'  => isset( $merged['container_width'] )  ? (int)   $merged['container_width']  : 0,
			'containerHeight' => isset( $merged['container_height'] ) ? (int)   $merged['container_height'] : 0,
			'fullWidth'       => (bool) ( $merged['full_width'] ?? false ),
			'bgType'          => isset( $merged['bg_type'] )          ? (string)$merged['bg_type']          : '',
			'bgColor'         => isset( $merged['bg_color'] )         ? (string)$merged['bg_color']         : '',
			'bgTransparent'   => (bool) ( $merged['bg_transparent'] ?? false ),
			'bgImageUrl'      => isset( $merged['bg_image_url'] )     ? (string)$merged['bg_image_url']     : '',
			'lightIntensity'  => isset( $merged['light_intensity'] )  ? (float) $merged['light_intensity']  : 1.0,
			'avatarScale'     => isset( $merged['avatar_scale'] )     ? (float) $merged['avatar_scale']     : 1.0,
			'avatarOffsetX'   => isset( $merged['avatar_offset_x'] )  ? (float) $merged['avatar_offset_x']  : 0.0,
			'avatarOffsetY'   => isset( $merged['avatar_offset_y'] )  ? (float) $merged['avatar_offset_y']  : 0.0,
			'cameraPreset'    => isset( $merged['camera_preset'] )    ? (string)$merged['camera_preset']    : 'front',
			'cameraRotationY' => isset( $merged['camera_rotation_y'] ) ? (float)$merged['camera_rotation_y'] : 0.0,
			'chatShow'        => (bool) ( $merged['chat_show'] ?? false ),
			'chatPlacement'   => isset( $merged['chat_placement'] )   ? (string)$merged['chat_placement']   : 'beside',
		);
	}
}
