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
			'instructions' => '' !== $instructions ? $instructions : self::DEFAULT_INSTRUCTIONS,
			'voice'        => '' !== $voice ? $voice : self::DEFAULT_VOICE,
			'avatar_url'   => $avatar_url,
			'model'        => '' !== $model ? $model : self::DEFAULT_MODEL,
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
