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
	 * Allowlisted OpenAI Realtime voices (D-05). A per-instance voice
	 * override carried in the incoming sessionConfig is honored ONLY when
	 * it is strictly one of these — anything else falls back to the
	 * admin's global voice. Source of truth:
	 * packages/core/src/types/realtime.ts voice union (mirrors the same
	 * allowlist already enforced in Admin/SettingsPage.php::VOICES, the
	 * CR-01/CR-01-NEW precedent for this exact validation shape).
	 *
	 * @var string[]
	 */
	private const ALLOWED_VOICES = [
		'alloy',
		'ash',
		'ballad',
		'coral',
		'echo',
		'sage',
		'shimmer',
		'verse',
		'marin',
		'cedar',
	];

	/**
	 * Max length (chars) for a per-instance instructions override carried
	 * in the incoming sessionConfig (D-05). Reduces prompt-injection blast
	 * radius; does not content-filter within the cap (accepted residual
	 * risk — see 08-RESEARCH.md Security Domain table).
	 *
	 * @var int
	 */
	private const MAX_INSTRUCTIONS_LENGTH = 2000;

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
	 * Enforce D-07's jailbreak-closure while honoring EMBED-02's D-05
	 * per-instance overrides: a candidate voice/instructions carried in
	 * the incoming sessionConfig (the SAME fields the bundle already
	 * sends on every request — `audio.output.voice` and `instructions`,
	 * populated from the bundle's RealtimeConfig) is forced into the
	 * final session config ONLY when it passes strict allowlist/cap
	 * validation; anything else (empty, missing, or invalid) falls back
	 * to the admin's global config, byte-for-byte the Phase 6 D-07
	 * behavior. The candidate is validated FIRST, never branched on
	 * "was an override requested" (Pitfall 4 / CR-01 precedent), so
	 * there is no code path where an unvalidated value reaches
	 * mint_session(). No distinct error/detail is ever surfaced for a
	 * rejected override (D-09-style fail-closed silence).
	 *
	 * Reads get_runtime_config() and must be called BEFORE mint_session()
	 * in create_session() below — that ordering is the trust boundary.
	 *
	 * @param array $session_config Client-sent sessionConfig (untrusted).
	 * @return array Sanitized sessionConfig safe to pass to mint_session().
	 */
	private function apply_trust_model( array $session_config ): array {
		$runtime_config = $this->config_source->get_runtime_config();

		// Read the candidate override values OUT of the incoming
		// sessionConfig itself before forcing anything — there is no
		// separate `instanceOverrides` wire field; the bundle already
		// embeds per-instance voice/instructions here.
		$candidate_voice        = isset( $session_config['audio']['output']['voice'] ) && is_string( $session_config['audio']['output']['voice'] )
			? $session_config['audio']['output']['voice']
			: '';
		$candidate_instructions = isset( $session_config['instructions'] ) && is_string( $session_config['instructions'] )
			? $session_config['instructions']
			: '';

		// Validate-or-fallback: validate the candidate FIRST, strict
		// in_array (CR-01 precedent) — never trust an unvalidated value,
		// and never branch on "was an override sent" before validating.
		$voice        = in_array( $candidate_voice, self::ALLOWED_VOICES, true )
			? $candidate_voice
			: $runtime_config['voice'];
		$instructions = ( '' !== $candidate_instructions && strlen( $candidate_instructions ) <= self::MAX_INSTRUCTIONS_LENGTH )
			? $candidate_instructions
			: $runtime_config['instructions'];

		$session_config['instructions'] = $instructions;

		// OpenAI's realtime session schema has no top-level `voice` field —
		// voice only exists at `audio.output.voice`, and OpenAI rejects any
		// unrecognized top-level parameter outright. Strip a client-sent
		// top-level `voice` and always force the validated/fallback voice
		// into the correct nested location, creating the audio.output
		// structure if the client didn't send one.
		unset( $session_config['voice'] );

		if ( ! isset( $session_config['audio'] ) || ! is_array( $session_config['audio'] ) ) {
			$session_config['audio'] = array();
		}
		if ( ! isset( $session_config['audio']['output'] ) || ! is_array( $session_config['audio']['output'] ) ) {
			$session_config['audio']['output'] = array();
		}
		$session_config['audio']['output']['voice'] = $voice;

		return $session_config;
	}

	/**
	 * Mint (or deny) an ephemeral OpenAI Realtime session token.
	 *
	 * Order of operations is load-bearing:
	 *   1. Rate-limit/cap check (D-05) — BEFORE resolving the API key, so
	 *      an abusive caller never even reaches key resolution.
	 *   2. Reserve the slot via record_mint() IMMEDIATELY after the check
	 *      passes — deliberately BEFORE the ~10s server-to-server OpenAI
	 *      call, not after a successful mint. Recording after the network
	 *      call left a check-then-act window: two concurrent requests from
	 *      the same IP could each pass is_allowed() before either one
	 *      recorded, bypassing both the per-IP and sitewide caps (CR-01).
	 *      Reserving here shrinks that window to the handful of in-process
	 *      instructions between the two calls, and as a side effect also
	 *      means a flood of requests that all fail at the provider (e.g.
	 *      a misconfigured key) now counts against the limiter too, instead
	 *      of being free to retry indefinitely.
	 *   3. API key resolution — 503 if unconfigured.
	 *   4. Trust-model override (D-07/D-05) via apply_trust_model() above
	 *      — a per-instance voice/instructions candidate carried in the
	 *      client's sessionConfig is honored only when allowlist/cap-valid,
	 *      otherwise the admin's global config wins; applied BEFORE
	 *      mint_session() is called.
	 *   5. Mint via the injected TokenProviderInterface — 502 generic on
	 *      failure (D-09), 200 on success. The reservation from step 2
	 *      already counted either way.
	 *
	 * @param \WP_REST_Request $request
	 * @return \WP_REST_Response
	 */
	public function create_session( $request ) {
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? (string) $_SERVER['REMOTE_ADDR'] : '';

		if ( ! $this->rate_limiter->is_allowed( $ip ) ) {
			return $this->respond( array( 'error' => 'rate_limited' ), 429 );
		}

		$this->rate_limiter->record_mint( $ip );

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
