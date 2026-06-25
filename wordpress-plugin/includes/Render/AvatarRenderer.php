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
	 * @param array $merged Merged instance+global config.
	 * @return array{voice: string, instructions: string, avatarUrl: string, model: string, restUrl: string}
	 */
	private function public_safe( array $merged ): array {
		return array(
			'voice'        => isset( $merged['voice'] ) ? (string) $merged['voice'] : '',
			'instructions' => isset( $merged['instructions'] ) ? (string) $merged['instructions'] : '',
			'avatarUrl'    => isset( $merged['avatar_url'] ) ? (string) $merged['avatar_url'] : '',
			'model'        => isset( $merged['model'] ) ? (string) $merged['model'] : '',
			'restUrl'      => rest_url( 'khaveeai/v1/session' ),
		);
	}
}
