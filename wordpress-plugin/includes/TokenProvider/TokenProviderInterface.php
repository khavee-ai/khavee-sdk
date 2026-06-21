<?php
/**
 * TokenProviderInterface — the one-method strategy seam for minting an
 * ephemeral OpenAI Realtime session token.
 *
 * This interface exists so a future "Platform mode" token provider
 * (backed by the khavee-app hosted API) can be swapped in later without
 * touching SessionController or any JS bundle code. The only contract
 * that must hold across every implementation is the method signature
 * and return shape below.
 *
 * @package Khavee\Plugin\TokenProvider
 */

namespace Khavee\Plugin\TokenProvider;

interface TokenProviderInterface {
	/**
	 * Mint a short-lived OpenAI Realtime ephemeral session token.
	 *
	 * DI rule (non-negotiable): implementations MUST receive the API key
	 * as the $api_key parameter and MUST NOT read it from wp_options (or
	 * any other config store) themselves. The caller (SessionController,
	 * via ConfigSourceInterface::get_api_key()) owns key resolution. This
	 * is the seam that lets a future Platform-mode provider swap in
	 * without this interface or its callers changing.
	 *
	 * @param array  $session_config Shape matching OpenAIRealtimeProvider's
	 *                                sessionConfig (model, instructions, voice,
	 *                                tools, audio). Already trust-model-sanitized
	 *                                by the caller — this method must not
	 *                                re-inject instructions/voice itself.
	 * @param string $api_key        The real OpenAI API key, resolved by the
	 *                                caller and passed in directly.
	 *
	 * @return array{ephemeralToken: string, sessionId: ?string, expiresAt: ?int}
	 */
	public function mint_session( array $session_config, string $api_key ): array;
}
