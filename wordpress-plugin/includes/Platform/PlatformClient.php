<?php
/**
 * PlatformClient — cached HTTP client for the hosted Khavee Platform's
 * project-preview endpoint, plus a pure field-mapping helper.
 *
 * @package Khavee\Plugin\Platform
 */

namespace Khavee\Plugin\Platform;

/**
 * Server-side-only client for GET https://api.platform.khavee.ai/api/v1/projects/sdk/preview.
 *
 * Every public method here is safe to call speculatively (e.g. from
 * PlatformConfigSource::get_runtime_config() on every request, or from
 * SettingsPage's connection-status notice): fetch_preview() caches BOTH
 * success and failure outcomes behind a 5-minute WP transient keyed on a
 * hash of the key, so a broken/missing key never hammers the platform API,
 * and failures are normalized to a short generic reason — never the raw
 * key, a WP_Error's internal message, or an exception/stack trace (T-QK-03).
 */
final class PlatformClient {

	/**
	 * The hosted Khavee Platform's SDK project-preview endpoint.
	 *
	 * @var string
	 */
	private const ENDPOINT = 'https://api.platform.khavee.ai/api/v1/projects/sdk/preview';

	/**
	 * Transient cache TTL in seconds (5 minutes) — bounds how often a
	 * configured platform key triggers a real network call (T-QK-04).
	 *
	 * @var int
	 */
	private const CACHE_TTL = 300;

	/**
	 * wp_remote_get() timeout in seconds — bounds a hung request (T-QK-04).
	 *
	 * @var int
	 */
	private const TIMEOUT = 8;

	/**
	 * Map the platform's project-preview `data` envelope onto this plugin's
	 * flat runtime-config field names. Pure and side-effect-free.
	 *
	 * An overlay key is emitted ONLY when the corresponding platform value
	 * is present AND non-blank (after trimming) — a null/absent/blank
	 * platform field must never blank out the locally-configured value, so
	 * this method simply omits the key rather than emitting an empty
	 * string. The caller (PlatformConfigSource) merges the returned array
	 * OVER the wrapped config, so an omitted key naturally falls through to
	 * the wrapped value.
	 *
	 * Deliberately NOT mapped (left untouched, WP-admin-controlled): the
	 * OpenAI Realtime `model` id (a naming collision with the platform's
	 * `model` object, which describes the 3D avatar, not the LLM/voice
	 * model), camera fields, avatar scale/offset, chat show/placement,
	 * container sizing.
	 *
	 * @param array $data The platform response's `data` envelope.
	 * @return array<string, mixed> Only the keys that should overlay the
	 *                              wrapped config — may be empty.
	 */
	public static function map_platform_fields( array $data ): array {
		$fields = array();

		$voice_profile = isset( $data['voiceProfile'] ) && is_array( $data['voiceProfile'] ) ? $data['voiceProfile'] : null;

		if ( null !== $voice_profile ) {
			$voice = isset( $voice_profile['openaiVoice'] ) ? (string) $voice_profile['openaiVoice'] : '';
			if ( '' !== trim( $voice ) ) {
				$fields['voice'] = $voice;
			}

			$instructions = isset( $voice_profile['instructionPrompt'] ) ? (string) $voice_profile['instructionPrompt'] : '';
			if ( '' !== trim( $instructions ) ) {
				$fields['instructions'] = $instructions;
			}
		}

		$model = isset( $data['model'] ) && is_array( $data['model'] ) ? $data['model'] : null;

		if ( null !== $model ) {
			$avatar_url = isset( $model['model3dUrl'] ) ? (string) $model['model3dUrl'] : '';
			if ( '' !== trim( $avatar_url ) ) {
				$fields['avatar_url'] = $avatar_url;
			}
		}

		if ( isset( $data['lightIntensity'] ) && '' !== $data['lightIntensity'] && null !== $data['lightIntensity'] ) {
			$fields['light_intensity'] = (float) $data['lightIntensity'];
		}

		$background_type  = isset( $data['backgroundType'] ) ? (string) $data['backgroundType'] : '';
		$background_value = isset( $data['backgroundValue'] ) ? (string) $data['backgroundValue'] : '';

		if ( 'image' === $background_type ) {
			$fields['bg_type']      = 'image';
			$fields['bg_image_url'] = $background_value;
		} elseif ( 'color' === $background_type ) {
			$fields['bg_type']  = 'color';
			$fields['bg_color'] = $background_value;
		}
		// Any other/unrecognized backgroundType: leave bg_* untouched (pass through).

		return $fields;
	}

	/**
	 * Fetch (or return the cached) project-preview struct for the given
	 * platform key.
	 *
	 * Caches BOTH ok and error outcomes for CACHE_TTL seconds behind a
	 * transient keyed on a hash of the key — never the raw key itself — so
	 * a broken key does not hammer the platform API on every render
	 * (T-QK-04). Any failure (WP_Error, non-200, malformed/non-array JSON,
	 * or a missing `data` envelope) normalizes to ok=false with a SHORT
	 * generic error reason; the raw key, WP_Error internals, and any
	 * exception/stack trace are never included (T-QK-03, T-QK-06).
	 *
	 * @param string $key The raw platform API key.
	 * @return array{ok: bool, project_name: string, fields: array, error: string}
	 */
	public static function fetch_preview( string $key ): array {
		$cache_key = 'khaveeai_platform_' . md5( $key );
		$cached    = get_transient( $cache_key );

		if ( is_array( $cached ) ) {
			return $cached;
		}

		$result = self::do_fetch_preview( $key );

		set_transient( $cache_key, $result, self::CACHE_TTL );

		return $result;
	}

	/**
	 * Uncached fetch + envelope-unwrap. Wrapped in try/catch so any
	 * unexpected Throwable (e.g. a hostile/malformed response tripping an
	 * unforeseen edge case) still normalizes to ok=false rather than
	 * fataling the caller (T-QK-06).
	 *
	 * @param string $key The raw platform API key.
	 * @return array{ok: bool, project_name: string, fields: array, error: string}
	 */
	private static function do_fetch_preview( string $key ): array {
		try {
			$response = wp_remote_get(
				self::ENDPOINT,
				array(
					'headers' => array( 'X-API-Key' => $key ),
					'timeout' => self::TIMEOUT,
				)
			);

			if ( is_wp_error( $response ) ) {
				// Real detail is intentionally NOT surfaced anywhere (T-QK-03) —
				// this class has no error_log() call site of its own; callers
				// (e.g. SettingsPage's connection notice) only ever see 'error'.
				return self::failure( 'network error' );
			}

			$status_code = wp_remote_retrieve_response_code( $response );

			if ( 200 !== $status_code ) {
				return self::failure( 'HTTP ' . $status_code );
			}

			$raw_body = wp_remote_retrieve_body( $response );
			$body     = json_decode( $raw_body, true );

			if ( ! is_array( $body ) || ! isset( $body['data'] ) || ! is_array( $body['data'] ) ) {
				return self::failure( 'malformed response' );
			}

			$data = $body['data'];

			return array(
				'ok'           => true,
				'project_name' => isset( $data['name'] ) ? (string) $data['name'] : '',
				'fields'       => self::map_platform_fields( $data ),
				'error'        => '',
			);
		} catch ( \Throwable $e ) {
			return self::failure( 'unexpected error' );
		}
	}

	/**
	 * Build a normalized ok=false result struct.
	 *
	 * @param string $reason A short, generic, non-sensitive reason.
	 * @return array{ok: bool, project_name: string, fields: array, error: string}
	 */
	private static function failure( string $reason ): array {
		return array(
			'ok'           => false,
			'project_name' => '',
			'fields'       => array(),
			'error'        => $reason,
		);
	}
}
