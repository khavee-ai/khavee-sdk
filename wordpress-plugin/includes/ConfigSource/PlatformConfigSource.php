<?php
/**
 * PlatformConfigSource — ConfigSourceInterface decorator overlaying
 * hosted-platform config on top of a wrapped source.
 *
 * @package Khavee\Plugin\ConfigSource
 */

namespace Khavee\Plugin\ConfigSource;

use Khavee\Plugin\Platform\PlatformClient;

/**
 * Decorates a wrapped ConfigSourceInterface (in practice, WpOptionsConfigSource)
 * and overlays fields fetched from the hosted Khavee Platform when a
 * platform key is configured — "platform always wins" for the mapped
 * fields (voice, instructions, avatar_url, light_intensity, background).
 *
 * Failure semantics are strictly additive-or-nothing: absent key, a failed
 * fetch (network error, non-200, malformed JSON), or any unexpected
 * Throwable all fall back to the wrapped source's config VERBATIM — this
 * class never fatals and never blanks a field the wrapped source provided.
 *
 * get_api_key()/is_configured() are untouched pass-throughs: the platform
 * key is a completely separate secret from the OpenAI key those methods
 * describe, and this class never exposes it via the interface (T-QK-02).
 */
final class PlatformConfigSource implements ConfigSourceInterface {

	/**
	 * Option name the settings blob (incl. platform_api_key) is stored
	 * under. Matches WpOptionsConfigSource::OPTION_NAME exactly — this
	 * class reads get_option() directly rather than adding a method to
	 * ConfigSourceInterface for the platform key (per the plan: "do NOT add
	 * a method to the interface").
	 *
	 * @var string
	 */
	private const OPTION_NAME = 'khaveeai_settings';

	/**
	 * The wrapped ConfigSourceInterface this class decorates.
	 *
	 * @var ConfigSourceInterface
	 */
	private $wrapped;

	/**
	 * @param ConfigSourceInterface $wrapped The source to overlay platform
	 *                                       fields on top of.
	 */
	public function __construct( ConfigSourceInterface $wrapped ) {
		$this->wrapped = $wrapped;
	}

	/**
	 * {@inheritDoc}
	 *
	 * Starts from the wrapped source's config. When a non-empty platform
	 * key is configured AND PlatformClient::fetch_preview() succeeds, the
	 * mapped fields are merged OVER the wrapped config (mapped keys win).
	 * Any other outcome (no key, fetch failure, unexpected Throwable)
	 * returns the wrapped config unchanged.
	 */
	public function get_runtime_config(): array {
		$config = $this->wrapped->get_runtime_config();

		try {
			$settings = get_option( self::OPTION_NAME, array() );
			$settings = is_array( $settings ) ? $settings : array();

			$platform_key = isset( $settings['platform_api_key'] ) ? (string) $settings['platform_api_key'] : '';

			if ( '' === $platform_key ) {
				return $config;
			}

			$result = PlatformClient::fetch_preview( $platform_key );

			if ( ! is_array( $result ) || empty( $result['ok'] ) ) {
				return $config;
			}

			$fields = isset( $result['fields'] ) && is_array( $result['fields'] ) ? $result['fields'] : array();

			// Mapped fields win — merged OVER the wrapped config.
			return array_merge( $config, $fields );
		} catch ( \Throwable $e ) {
			// Never fatal — silent fallback to the wrapped config (T-QK-06).
			return $config;
		}
	}

	/**
	 * {@inheritDoc}
	 *
	 * Untouched pass-through — the platform key is unrelated to the OpenAI
	 * secret this method describes.
	 */
	public function get_api_key(): string {
		return $this->wrapped->get_api_key();
	}

	/**
	 * {@inheritDoc}
	 *
	 * Untouched pass-through.
	 */
	public function is_configured(): bool {
		return $this->wrapped->is_configured();
	}
}
