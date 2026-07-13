<?php
/**
 * KnowledgeClient — calls the hosted Khavee Platform's project-scoped
 * knowledge-base endpoints. Mirrors PlatformClient's request/error-handling
 * shape exactly (see PlatformClient.php for the pattern this follows).
 *
 * WordPress never talks to Postgres/pgvector directly — most WP hosting has
 * no pgsql/pdo_pgsql extension, and the knowledge base lives in the SAME
 * database the admin's khavee-app project already uses. This class only
 * ever calls the platform's REST API with the site's own Platform API key.
 *
 * @package Khavee\Plugin\Platform
 */

namespace Khavee\Plugin\Platform;

final class KnowledgeClient {

	/**
	 * Base URL for the sdk/knowledge routes. Same host/prefix as
	 * PlatformClient::ENDPOINT, different path.
	 *
	 * @var string
	 */
	private const BASE_URL = 'https://api.platform.khavee.ai/api/v1/projects/sdk/knowledge';

	/**
	 * Search results change less often than avatar config within a single
	 * conversation, but a short cache still meaningfully cuts calls during
	 * back-to-back questions on the same topic. Deliberately shorter than
	 * PlatformClient::CACHE_TTL (300s) since stale search results are more
	 * noticeable to an end visitor than a stale avatar color.
	 *
	 * @var int
	 */
	private const SEARCH_CACHE_TTL = 60;

	/**
	 * @var int
	 */
	private const TIMEOUT = 8;

	/**
	 * Search the calling project's knowledge base.
	 *
	 * @param string $key   The raw platform API key.
	 * @param string $query Natural-language search query.
	 * @param int    $top_k Max number of results.
	 * @return array{ok: bool, results: array, error: string}
	 */
	public static function search( string $key, string $query, int $top_k = 5 ): array {
		$cache_key = 'khaveeai_knowledge_search_' . md5( $key . '|' . $query . '|' . $top_k );
		$cached    = get_transient( $cache_key );

		if ( is_array( $cached ) ) {
			return $cached;
		}

		$result = self::do_search( $key, $query, $top_k );

		set_transient( $cache_key, $result, self::SEARCH_CACHE_TTL );

		return $result;
	}

	/**
	 * Uncached search request. Wrapped in try/catch so any unexpected
	 * Throwable normalizes to ok=false rather than fataling the caller,
	 * matching PlatformClient::do_fetch_preview()'s guarantee.
	 *
	 * @param string $key
	 * @param string $query
	 * @param int    $top_k
	 * @return array{ok: bool, results: array, error: string}
	 */
	private static function do_search( string $key, string $query, int $top_k ): array {
		try {
			$response = wp_remote_get(
				self::BASE_URL . '/search?' . http_build_query(
					array(
						'query' => $query,
						'topK'  => $top_k,
					)
				),
				array(
					'headers' => array( 'X-API-Key' => $key ),
					'timeout' => self::TIMEOUT,
				)
			);

			if ( is_wp_error( $response ) ) {
				return self::failure( 'network error' );
			}

			$status_code = wp_remote_retrieve_response_code( $response );

			if ( 200 !== $status_code ) {
				return self::failure( 'HTTP ' . $status_code );
			}

			$body = json_decode( wp_remote_retrieve_body( $response ), true );

			if ( ! is_array( $body ) || ! isset( $body['data'] ) || ! is_array( $body['data'] ) ) {
				return self::failure( 'malformed response' );
			}

			return array(
				'ok'      => true,
				'results' => isset( $body['data']['results'] ) && is_array( $body['data']['results'] )
					? $body['data']['results']
					: array(),
				'error'   => '',
			);
		} catch ( \Throwable $e ) {
			return self::failure( 'unexpected error' );
		}
	}

	/**
	 * List documents in the calling project's knowledge base. Not cached —
	 * used by the admin-facing Settings page status check, not the
	 * high-frequency tool-call search path.
	 *
	 * @param string $key
	 * @param int    $limit
	 * @return array{ok: bool, documents: array, error: string}
	 */
	public static function list_documents( string $key, int $limit = 50 ): array {
		try {
			$response = wp_remote_get(
				self::BASE_URL . '?' . http_build_query( array( 'limit' => $limit ) ),
				array(
					'headers' => array( 'X-API-Key' => $key ),
					'timeout' => self::TIMEOUT,
				)
			);

			if ( is_wp_error( $response ) ) {
				return array(
					'ok'        => false,
					'documents' => array(),
					'error'     => 'network error',
				);
			}

			$status_code = wp_remote_retrieve_response_code( $response );

			if ( 200 !== $status_code ) {
				return array(
					'ok'        => false,
					'documents' => array(),
					'error'     => 'HTTP ' . $status_code,
				);
			}

			$body = json_decode( wp_remote_retrieve_body( $response ), true );

			if ( ! is_array( $body ) || ! isset( $body['data'] ) || ! is_array( $body['data'] ) ) {
				return array(
					'ok'        => false,
					'documents' => array(),
					'error'     => 'malformed response',
				);
			}

			return array(
				'ok'        => true,
				'documents' => isset( $body['data']['documents'] ) && is_array( $body['data']['documents'] )
					? $body['data']['documents']
					: array(),
				'error'     => '',
			);
		} catch ( \Throwable $e ) {
			return array(
				'ok'        => false,
				'documents' => array(),
				'error'     => 'unexpected error',
			);
		}
	}

	/**
	 * Build a normalized ok=false search result struct.
	 *
	 * @param string $reason A short, generic, non-sensitive reason.
	 * @return array{ok: bool, results: array, error: string}
	 */
	private static function failure( string $reason ): array {
		return array(
			'ok'      => false,
			'results' => array(),
			'error'   => $reason,
		);
	}
}
