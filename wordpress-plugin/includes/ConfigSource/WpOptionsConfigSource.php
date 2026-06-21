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
 * This phase only READS the settings blob; Phase 7's admin settings page
 * sanitizes the blob on write (sanitize_text_field()/sanitize_textarea_field()),
 * so no additional validation is performed here on read.
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

		$instructions = isset( $settings['instructions'] ) ? (string) $settings['instructions'] : '';
		$voice        = isset( $settings['voice'] ) ? (string) $settings['voice'] : '';
		$model        = isset( $settings['model'] ) ? (string) $settings['model'] : '';
		$avatar_url   = isset( $settings['avatar_url'] ) ? (string) $settings['avatar_url'] : '';

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
}
