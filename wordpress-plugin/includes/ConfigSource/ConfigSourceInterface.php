<?php
/**
 * Config-source strategy contract.
 *
 * @package Khavee\Plugin\ConfigSource
 */

namespace Khavee\Plugin\ConfigSource;

/**
 * Two-method seam for resolving plugin configuration.
 *
 * This is the swappable strategy that lets a future Platform-mode config
 * source (pulling settings from the hosted khavee-app dashboard instead of
 * wp_options) replace WpOptionsConfigSource without touching the REST
 * contract or the JS bundle.
 */
interface ConfigSourceInterface {

	/**
	 * Public-safe runtime config consumed by the REST response and the JS bundle.
	 *
	 * MUST NOT include the API key or any other secret — this array's contents
	 * are safe to serialize into a REST response body or inline JS payload.
	 *
	 * @return array{instructions: string, voice: string, avatar_url: string, model: string}
	 */
	public function get_runtime_config(): array;

	/**
	 * Server-side-only secret (the OpenAI API key).
	 *
	 * Must never be serialized into a REST response or the JS bundle, logged,
	 * or merged into the array returned by get_runtime_config(). Only ever
	 * consumed by TokenProviderInterface implementations on the server.
	 *
	 * @return string
	 */
	public function get_api_key(): string;

	/**
	 * Whether the API key has been configured (non-empty). Does NOT
	 * verify the key is valid/working — only that one has been entered.
	 *
	 * Additive, backward-compatible extension of the Phase 6 contract (D-13):
	 * existing get_runtime_config()/get_api_key() signatures are unchanged and
	 * SessionController's usage is unaffected. Consumed by this phase's own
	 * settings-page "not configured" status banner (D-14) and Phase 8's
	 * frontend embed admin-only notice (SET-06 / D-12), giving both surfaces
	 * a single source of truth instead of re-deriving "is this configured"
	 * from get_api_key() at each call site.
	 *
	 * @return bool
	 */
	public function is_configured(): bool;
}
