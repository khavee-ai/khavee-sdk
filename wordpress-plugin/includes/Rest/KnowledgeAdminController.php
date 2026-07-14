<?php
/**
 * KnowledgeAdminController — authenticated wp-admin REST routes for
 * managing (list/add/delete) the site's knowledge-base documents directly
 * from the Settings page, so an admin never has to leave WordPress.
 *
 * Unlike KnowledgeSearchController (the public/unauthenticated route the
 * browser-side voice tool calls mid-conversation), every route here
 * performs a PRIVILEGED MUTATION against the platform project's knowledge
 * base and is gated on current_user_can('manage_options') — the same
 * capability check that gates the Settings page itself — plus the
 * standard wp_rest cookie-nonce WordPress core validates for any
 * logged-in REST request. Never '__return_true' here.
 *
 * @package Khavee\Plugin\Rest
 */

namespace Khavee\Plugin\Rest;

use Khavee\Plugin\Platform\KnowledgeClient;

final class KnowledgeAdminController {

	/**
	 * Option name the settings blob (incl. platform_api_key) is stored
	 * under. Matches KnowledgeSearchController::OPTION_NAME /
	 * WpOptionsConfigSource::OPTION_NAME exactly.
	 *
	 * @var string
	 */
	private const OPTION_NAME = 'khaveeai_settings';

	/**
	 * Defensive cap on a single document's content length, mirroring
	 * KnowledgeSearchController::MAX_QUERY_LENGTH's rationale (reduces
	 * abuse blast radius) — sized much larger since documents are
	 * legitimately long-form content, unlike a search query.
	 *
	 * @var int
	 */
	private const MAX_CONTENT_LENGTH = 20000;

	/**
	 * Max value accepted for the `limit` query param on the list route.
	 *
	 * @var int
	 */
	private const MAX_LIMIT = 100;

	/**
	 * Register the admin knowledge-base management routes on the WP REST
	 * API. All three are capability-gated — this controller performs
	 * privileged mutations, unlike KnowledgeSearchController's public
	 * search-only route.
	 *
	 * @return void
	 */
	public function register_routes(): void {
		register_rest_route(
			'khaveeai/v1',
			'/knowledge-admin',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'list_documents' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		register_rest_route(
			'khaveeai/v1',
			'/knowledge-admin',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'create' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		register_rest_route(
			'khaveeai/v1',
			'/knowledge-admin/(?P<id>[^/]+)',
			array(
				'methods'             => 'DELETE',
				'callback'            => array( $this, 'delete' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);
	}

	/**
	 * Shared permission callback for all three routes.
	 *
	 * @return bool
	 */
	public function check_permission(): bool {
		return current_user_can( 'manage_options' );
	}

	/**
	 * GET /knowledge-admin — list the site's configured project's
	 * knowledge-base documents.
	 *
	 * @param \WP_REST_Request $request
	 * @return \WP_REST_Response
	 */
	public function list_documents( $request ) {
		$api_key = $this->get_api_key();

		if ( '' === $api_key ) {
			return $this->respond( array( 'error' => 'no_platform_key' ), 400 );
		}

		$limit = $request->get_param( 'limit' );
		$limit = is_numeric( $limit ) && (int) $limit > 0 ? min( (int) $limit, self::MAX_LIMIT ) : 50;

		$result = KnowledgeClient::list_documents( $api_key, $limit );

		if ( empty( $result['ok'] ) ) {
			return $this->respond( array( 'error' => 'request_failed' ), 502 );
		}

		return $this->respond( array( 'data' => self::strip_internal_metadata( $result['documents'] ) ), 200 );
	}

	/**
	 * POST /knowledge-admin — add a new document.
	 *
	 * @param \WP_REST_Request $request
	 * @return \WP_REST_Response
	 */
	public function create( $request ) {
		$api_key = $this->get_api_key();

		if ( '' === $api_key ) {
			return $this->respond( array( 'error' => 'no_platform_key' ), 400 );
		}

		$content = $request->get_param( 'content' );

		if ( ! is_string( $content ) || '' === trim( $content ) ) {
			return $this->respond( array( 'error' => 'invalid_content' ), 400 );
		}

		if ( mb_strlen( $content, 'UTF-8' ) > self::MAX_CONTENT_LENGTH ) {
			$content = mb_substr( $content, 0, self::MAX_CONTENT_LENGTH, 'UTF-8' );
		}

		$metadata = $request->get_param( 'metadata' );

		if ( is_string( $metadata ) ) {
			$decoded  = json_decode( $metadata, true );
			$metadata = is_array( $decoded ) ? $decoded : array();
		} elseif ( ! is_array( $metadata ) ) {
			$metadata = array();
		}

		$result = KnowledgeClient::insert( $api_key, $content, $metadata );

		if ( empty( $result['ok'] ) ) {
			return $this->respond( array( 'error' => 'request_failed' ), 502 );
		}

		$document = $result['document'];
		if ( is_array( $document ) && isset( $document['metadata'] ) && is_array( $document['metadata'] ) ) {
			unset( $document['metadata']['userId'], $document['metadata']['projectId'] );
		}

		return $this->respond( array( 'data' => $document ), 201 );
	}

	/**
	 * DELETE /knowledge-admin/{id} — remove a document.
	 *
	 * @param \WP_REST_Request $request
	 * @return \WP_REST_Response
	 */
	public function delete( $request ) {
		$api_key = $this->get_api_key();

		if ( '' === $api_key ) {
			return $this->respond( array( 'error' => 'no_platform_key' ), 400 );
		}

		$id = (string) $request['id'];

		if ( '' === $id ) {
			return $this->respond( array( 'error' => 'invalid_id' ), 400 );
		}

		$result = KnowledgeClient::delete( $api_key, $id );

		if ( empty( $result['ok'] ) ) {
			return $this->respond( array( 'error' => 'request_failed' ), 502 );
		}

		return $this->respond( array( 'data' => array( 'deleted' => true ) ), 200 );
	}

	/**
	 * Read the site's configured platform_api_key from the settings
	 * option, matching KnowledgeSearchController::search()'s read.
	 *
	 * @return string
	 */
	private function get_api_key(): string {
		$settings = get_option( self::OPTION_NAME, array() );
		$settings = is_array( $settings ) ? $settings : array();

		return isset( $settings['platform_api_key'] ) ? (string) $settings['platform_api_key'] : '';
	}

	/**
	 * Strips platform-internal fields (userId, projectId — the calling
	 * account's and project's own database ids) out of each document
	 * before it crosses this route's boundary. Defense in depth: this
	 * route IS manage_options-gated (unlike KnowledgeSearchController's
	 * public route), but the wp-admin UI never needs these ids either —
	 * matches KnowledgeSearchController::strip_internal_metadata()'s
	 * rationale exactly.
	 *
	 * @param array $documents
	 * @return array
	 */
	private static function strip_internal_metadata( array $documents ): array {
		foreach ( $documents as &$doc ) {
			if ( is_array( $doc ) && isset( $doc['metadata'] ) && is_array( $doc['metadata'] ) ) {
				unset( $doc['metadata']['userId'], $doc['metadata']['projectId'] );
			}
		}
		return $documents;
	}

	/**
	 * Build a WP_REST_Response with the mandatory Cache-Control: no-store
	 * header, matching KnowledgeSearchController::respond()'s pattern.
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
