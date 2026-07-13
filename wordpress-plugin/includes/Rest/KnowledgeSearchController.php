<?php
/**
 * KnowledgeSearchController — the public REST route the browser-side
 * knowledge-base tool calls mid-conversation.
 *
 * `RealtimeTool.execute()` (packages/core/src/types/realtime.ts) runs
 * CLIENT-SIDE in the browser, so it can never hold the site's Platform API
 * key. This route holds the key server-side (same option the Settings page
 * already stores it under) and proxies to KnowledgeClient::search() —
 * mirroring SessionController's public/unauthenticated route shape: the
 * caller is an anonymous site visitor, the trust boundary is "the key never
 * leaves the server," not route auth (same rationale as SessionController's
 * own doc comment).
 *
 * @package Khavee\Plugin\Rest
 */

namespace Khavee\Plugin\Rest;

use Khavee\Plugin\Platform\KnowledgeClient;

final class KnowledgeSearchController {

	/**
	 * Option name the settings blob (incl. platform_api_key) is stored
	 * under. Matches WpOptionsConfigSource::OPTION_NAME / PlatformConfigSource's
	 * own constant exactly — this class reads get_option() directly rather
	 * than adding a method to ConfigSourceInterface, same rationale
	 * PlatformConfigSource documents for itself (platform key is a separate
	 * secret from what that interface describes).
	 *
	 * @var string
	 */
	private const OPTION_NAME = 'khaveeai_settings';

	/**
	 * Max length (chars) accepted for the incoming query — reduces
	 * prompt-injection/abuse blast radius, mirrors
	 * SessionController::MAX_INSTRUCTIONS_LENGTH's rationale.
	 *
	 * @var int
	 */
	private const MAX_QUERY_LENGTH = 500;

	/**
	 * Register the route on the WP REST API.
	 *
	 * @return void
	 */
	public function register_routes(): void {
		register_rest_route(
			'khaveeai/v1',
			'/knowledge-search',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'search' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	/**
	 * Search the site's configured project's knowledge base.
	 *
	 * @param \WP_REST_Request $request
	 * @return \WP_REST_Response
	 */
	public function search( $request ) {
		$query = $request->get_param( 'query' );

		if ( ! is_string( $query ) || '' === trim( $query ) ) {
			return $this->respond( array( 'error' => 'invalid_query' ), 400 );
		}

		if ( mb_strlen( $query, 'UTF-8' ) > self::MAX_QUERY_LENGTH ) {
			$query = mb_substr( $query, 0, self::MAX_QUERY_LENGTH, 'UTF-8' );
		}

		$settings  = get_option( self::OPTION_NAME, array() );
		$settings  = is_array( $settings ) ? $settings : array();
		$api_key   = isset( $settings['platform_api_key'] ) ? (string) $settings['platform_api_key'] : '';

		if ( '' === $api_key ) {
			// No platform key configured — silent empty result, not an
			// error, so a site without a knowledge base configured just
			// looks like "nothing found" to the model rather than
			// surfacing a config error mid-conversation.
			return $this->respond( array( 'data' => array( 'results' => array() ) ), 200 );
		}

		$top_k  = $request->get_param( 'topK' );
		$top_k  = is_numeric( $top_k ) && (int) $top_k > 0 ? min( (int) $top_k, 20 ) : 5;
		$result = KnowledgeClient::search( $api_key, $query, $top_k );

		if ( empty( $result['ok'] ) ) {
			// Same D-09-style fail-closed silence as SessionController:
			// no raw error detail crosses this boundary.
			return $this->respond( array( 'data' => array( 'results' => array() ) ), 200 );
		}

		return $this->respond( array( 'data' => array( 'results' => $result['results'] ) ), 200 );
	}

	/**
	 * Build a WP_REST_Response with the mandatory Cache-Control: no-store
	 * header, matching SessionController::respond()'s pattern.
	 *
	 * @param array $data
	 * @param int   $status
	 * @return \WP_REST_Response
	 */
	private function respond( array $data, int $status ) {
		$response = new \WP_REST_Response( $data, $status );
		$response->header( 'Cache-Control', 'no-store' );
		return $response;
	}
}
