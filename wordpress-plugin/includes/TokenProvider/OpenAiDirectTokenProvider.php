<?php
/**
 * OpenAiDirectTokenProvider — the single concrete TokenProviderInterface
 * implementation this milestone. Mints an OpenAI Realtime ephemeral
 * session token server-to-server via wp_remote_post().
 *
 * Security invariants (D-09, D-10, Backend Proxy Assumption):
 *  - The real API key crosses only in the outbound Authorization header,
 *    never in any value returned to the caller.
 *  - On any OpenAI/network failure, exactly one error_log() line records
 *    the real detail (status code / WP_Error message) for server-side
 *    debugging; the caller-visible failure signal (TokenMintException)
 *    carries no OpenAI response text, status detail, or key material.
 *
 * @package Khavee\Plugin\TokenProvider
 */

namespace Khavee\Plugin\TokenProvider;

/**
 * Thrown by OpenAiDirectTokenProvider::mint_session() when minting fails
 * for any reason (network error, non-2xx response, missing `value` field
 * in an otherwise-2xx response). Intentionally carries no OpenAI detail —
 * callers (e.g. SessionController, plan 03) should catch this and return
 * a generic HTTP 502 with no leaked detail. The real detail is available
 * only in the PHP error log via the error_log() call made before throwing.
 */
final class TokenMintException extends \RuntimeException {}

/**
 * wp_remote_post-based OpenAI ephemeral-token minter.
 */
final class OpenAiDirectTokenProvider implements TokenProviderInterface {

	/**
	 * OpenAI's ephemeral-token-minting endpoint.
	 *
	 * @var string
	 */
	private const ENDPOINT = 'https://api.openai.com/v1/realtime/client_secrets';

	/**
	 * {@inheritDoc}
	 *
	 * @throws TokenMintException On any network failure, non-2xx response,
	 *                            or a 2xx response missing the `value` field.
	 *                            Carries no OpenAI response detail — see
	 *                            class docblock above.
	 */
	public function mint_session( array $session_config, string $api_key ): array {
		// OpenAI's client_secrets endpoint requires the session config
		// nested under a top-level "session" key — posting it unwrapped
		// is rejected with `400 Unknown parameter` for every field.
		$response = wp_remote_post(
			self::ENDPOINT,
			array(
				'timeout' => 10,
				'headers' => array(
					'Authorization' => 'Bearer ' . $api_key,
					'Content-Type'  => 'application/json',
				),
				'body'    => wp_json_encode( array( 'session' => $session_config ) ),
			)
		);

		if ( is_wp_error( $response ) ) {
			// Real detail logged server-side only (D-10) — never returned to caller.
			error_log( 'khaveeai: OpenAI token mint failed (wp_remote_post error): ' . $response->get_error_message() );
			throw new TokenMintException( 'mint_failed' );
		}

		$status_code = wp_remote_retrieve_response_code( $response );

		if ( $status_code < 200 || $status_code >= 300 ) {
			// Real detail logged server-side only (D-10) — never returned to caller.
			error_log( 'khaveeai: OpenAI token mint failed (HTTP ' . $status_code . ')' );
			throw new TokenMintException( 'mint_failed' );
		}

		$raw_body = wp_remote_retrieve_body( $response );
		$body     = json_decode( $raw_body, true );

		$value = is_array( $body ) && isset( $body['value'] ) ? $body['value'] : null;

		if ( empty( $value ) ) {
			// 2xx response but no usable token — treat as a mint failure (D-09).
			error_log( 'khaveeai: OpenAI token mint failed (2xx response missing `value` field)' );
			throw new TokenMintException( 'mint_failed' );
		}

		$session     = is_array( $body ) && isset( $body['session'] ) && is_array( $body['session'] ) ? $body['session'] : array();
		$session_id  = isset( $session['id'] ) ? $session['id'] : null;
		$expires_at  = isset( $session['expires_at'] ) ? $session['expires_at'] : null;

		return array(
			'ephemeralToken' => $value,
			'sessionId'      => $session_id,
			'expiresAt'      => $expires_at,
		);
	}
}
