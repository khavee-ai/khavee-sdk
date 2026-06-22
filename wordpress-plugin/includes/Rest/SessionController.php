<?php
/**
 * SessionController — the public, abuse-resistant REST route that mints
 * OpenAI ephemeral session tokens for anonymous visitors.
 *
 * This is the integration-risk core of the milestone: the JSON response
 * shape below is consumed byte-for-byte by the existing, unmodifiable
 * `OpenAIRealtimeProvider.connect()` (packages/providers/openai-realtime).
 *
 * @package Khavee\Plugin\Rest
 */

namespace Khavee\Plugin\Rest;

use Khavee\Plugin\ConfigSource\ConfigSourceInterface;
use Khavee\Plugin\TokenProvider\TokenProviderInterface;
use Khavee\Plugin\TokenProvider\TokenMintException;
use Khavee\Plugin\RateLimit\RateLimiter;

/**
 * Wires ConfigSourceInterface + TokenProviderInterface + RateLimiter into
 * the `POST /khaveeai/v1/session` wire contract.
 *
 * Depends only on the strategy INTERFACES (plus the concrete RateLimiter
 * utility, which has exactly one implementation by design) — never
 * instantiates a concrete ConfigSource/TokenProvider itself. Plugin.php
 * is the only place those concretes are constructed.
 */
final class SessionController {

	/**
	 * @var ConfigSourceInterface
	 */
	private $config_source;

	/**
	 * @var TokenProviderInterface
	 */
	private $token_provider;

	/**
	 * @var RateLimiter
	 */
	private $rate_limiter;

	/**
	 * @param ConfigSourceInterface  $config_source
	 * @param TokenProviderInterface $token_provider
	 * @param RateLimiter            $rate_limiter
	 */
	public function __construct(
		ConfigSourceInterface $config_source,
		TokenProviderInterface $token_provider,
		RateLimiter $rate_limiter
	) {
		$this->config_source  = $config_source;
		$this->token_provider = $token_provider;
		$this->rate_limiter   = $rate_limiter;
	}

	/**
	 * Register the route on the WP REST API.
	 *
	 * `permission_callback => '__return_true'` is intentional: this route
	 * is deliberately PUBLIC and UNAUTHENTICATED (no wp_verify_nonce(),
	 * no is_user_logged_in()) because the consumer is an anonymous site
	 * visitor's browser. WP nonces do not protect anonymous requests and
	 * silently break under page caching (PITFALLS.md Pitfall 2). The
	 * security boundary here is the short-lived, scoped OpenAI ephemeral
	 * token itself plus RateLimiter's abuse mitigation below — not route
	 * auth.
	 *
	 * @return void
	 */
	public function register_routes(): void {
		register_rest_route(
			'khaveeai/v1',
			'/session',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'create_session' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	/**
	 * Enforce D-07: overwrite instructions/voice (top-level and the
	 * nested audio.output.voice path) with the admin's configured values,
	 * regardless of what the client sent. Per D-08, only the global admin
	 * config is supported this phase — no per-instance override params.
	 *
	 * Reads get_runtime_config() and must be called BEFORE mint_session()
	 * in create_session() below — that ordering is the trust boundary.
	 *
	 * @param array $session_config Client-sent sessionConfig (untrusted).
	 * @return array Sanitized sessionConfig safe to pass to mint_session().
	 */
	private function apply_trust_model( array $session_config ): array {
		$runtime_config = $this->config_source->get_runtime_config();

		$session_config['instructions'] = $runtime_config['instructions'];

		// OpenAI's realtime session schema has no top-level `voice` field —
		// voice only exists at `audio.output.voice`, and OpenAI rejects any
		// unrecognized top-level parameter outright. Strip a client-sent
		// top-level `voice` and always force the admin-configured voice
		// into the correct nested location, creating the audio.output
		// structure if the client didn't send one.
		unset( $session_config['voice'] );

		if ( ! isset( $session_config['audio'] ) || ! is_array( $session_config['audio'] ) ) {
			$session_config['audio'] = array();
		}
		if ( ! isset( $session_config['audio']['output'] ) || ! is_array( $session_config['audio']['output'] ) ) {
			$session_config['audio']['output'] = array();
		}
		$session_config['audio']['output']['voice'] = $runtime_config['voice'];

		return $session_config;
	}

	/**
	 * Mint (or deny) an ephemeral OpenAI Realtime session token.
	 *
	 * Order of operations is load-bearing:
	 *   1. Rate-limit/cap check (D-05) — BEFORE resolving the API key, so
	 *      an abusive caller never even reaches key resolution.
	 *   2. API key resolution — 503 if unconfigured.
	 *   3. Trust-model override (D-07/D-08) via apply_trust_model() above
	 *      — admin instructions/voice always win over whatever the client
	 *      sent, applied BEFORE mint_session() is called.
	 *   4. Mint via the injected TokenProviderInterface — 502 generic on
	 *      failure (D-09), record the mint and return 200 on success.
	 *
	 * @param \WP_REST_Request $request
	 * @return \WP_REST_Response
	 */
	public function create_session( $request ) {
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? (string) $_SERVER['REMOTE_ADDR'] : '';

		if ( ! $this->rate_limiter->is_allowed( $ip ) ) {
			return $this->respond( array( 'error' => 'rate_limited' ), 429 );
		}

		$api_key = $this->config_source->get_api_key();

		if ( empty( $api_key ) ) {
			return $this->respond( array( 'error' => 'khaveeai_not_configured' ), 503 );
		}

		$session_config = $request->get_param( 'sessionConfig' );
		if ( ! is_array( $session_config ) ) {
			$session_config = array();
		}

		$session_config = $this->apply_trust_model( $session_config );

		try {
			$result = $this->token_provider->mint_session( $session_config, $api_key );
		} catch ( TokenMintException $e ) {
			// D-09: generic body only — no OpenAI text/status/key info.
			return $this->respond( array( 'error' => 'session_unavailable' ), 502 );
		}

		$this->rate_limiter->record_mint( $ip );

		return $this->respond(
			array(
				'data' => array(
					'ephemeralToken' => $result['ephemeralToken'],
					'sessionId'      => $result['sessionId'] ?? null,
				),
			),
			200
		);
	}

	/**
	 * Build a WP_REST_Response with the mandatory Cache-Control: no-store
	 * header (REST-04) applied on every success/error path, per-route
	 * rather than globally.
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
