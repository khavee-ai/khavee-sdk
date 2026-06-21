<?php
/**
 * RateLimiter — two-level transient-backed abuse mitigation for the public
 * ephemeral-token route (T-06-06).
 *
 * Enforces BOTH a per-IP window limit (D-01) and a sitewide daily cap
 * (D-02/D-03) so a distributed-across-many-IPs attack still hits a ceiling.
 * Thresholds are filterable, not settings-page fields (D-04) — keeps the
 * Phase 7 settings page small and lets advanced admins override via code.
 *
 * @package Khavee\Plugin\RateLimit
 */

namespace Khavee\Plugin\RateLimit;

/**
 * Decision + recording API backed by WP transients.
 *
 * All WordPress function usage is intentionally limited to
 * get_transient()/set_transient()/apply_filters() so this class can run
 * unmodified against the in-memory stubs in
 * wordpress-plugin/tests/rest-logic-harness.php (no live WP install
 * required to prove the rate-limit math).
 */
final class RateLimiter {

	/**
	 * Default per-IP mint limit within DEFAULT_PER_IP_WINDOW (D-01).
	 *
	 * @var int
	 */
	const DEFAULT_PER_IP_LIMIT = 5;

	/**
	 * Default per-IP rate-limit window, in seconds (D-01: 10 minutes).
	 *
	 * @var int
	 */
	const DEFAULT_PER_IP_WINDOW = 10 * MINUTE_IN_SECONDS;

	/**
	 * Default sitewide daily mint cap (D-02/D-03).
	 *
	 * @var int
	 */
	const DEFAULT_DAILY_CAP = 200;

	/**
	 * Transient key prefix for the per-IP counter.
	 *
	 * @var string
	 */
	private const PER_IP_KEY_PREFIX = 'khaveeai_rl_';

	/**
	 * Transient key for the sitewide daily counter.
	 *
	 * @var string
	 */
	private const DAILY_KEY = 'khaveeai_daily_mints';

	/**
	 * Decide whether one more mint from $ip is currently allowed.
	 *
	 * Two-level check (D-02): denies if recording one more per-IP mint
	 * would exceed the per-IP limit, OR the sitewide-daily counter is
	 * already at/over the daily cap. Both checks run regardless of which
	 * one would deny first, since the caller only needs a single boolean.
	 *
	 * @param string $ip Client IP address (already resolved by the caller).
	 * @return bool True if the mint is allowed, false if it must be denied.
	 */
	public function is_allowed( string $ip ): bool {
		$per_ip_limit = (int) apply_filters( 'khaveeai_rate_limit_per_ip', self::DEFAULT_PER_IP_LIMIT );
		$daily_cap    = (int) apply_filters( 'khaveeai_rate_limit_daily', self::DEFAULT_DAILY_CAP );

		$per_ip_count = (int) get_transient( $this->per_ip_key( $ip ) );
		$daily_count  = (int) get_transient( self::DAILY_KEY );

		if ( $per_ip_count >= $per_ip_limit ) {
			return false;
		}

		if ( $daily_count >= $daily_cap ) {
			return false;
		}

		return true;
	}

	/**
	 * Record a successful mint, incrementing BOTH the per-IP and the
	 * sitewide-daily transient counters.
	 *
	 * Seeds each transient at 1 with the correct TTL when absent, per the
	 * standard get_transient()/set_transient() WP counter pattern.
	 *
	 * @param string $ip Client IP address (already resolved by the caller).
	 * @return void
	 */
	public function record_mint( string $ip ): void {
		$per_ip_window = (int) apply_filters( 'khaveeai_rate_limit_per_ip_window', self::DEFAULT_PER_IP_WINDOW );

		$this->increment_transient( $this->per_ip_key( $ip ), $per_ip_window );
		$this->increment_transient( self::DAILY_KEY, DAY_IN_SECONDS );
	}

	/**
	 * Build the per-IP transient key.
	 *
	 * @param string $ip Client IP address.
	 * @return string
	 */
	private function per_ip_key( string $ip ): string {
		return self::PER_IP_KEY_PREFIX . $ip;
	}

	/**
	 * Increment a transient counter, seeding it at 1 with $ttl when absent.
	 *
	 * @param string $key Transient key.
	 * @param int    $ttl TTL in seconds, applied only when the transient is
	 *                     (re)seeded — WP transients do not refresh TTL on
	 *                     a plain overwrite, matching the intended
	 *                     fixed-window behavior.
	 * @return void
	 */
	private function increment_transient( string $key, int $ttl ): void {
		$current = get_transient( $key );

		if ( false === $current ) {
			set_transient( $key, 1, $ttl );
			return;
		}

		set_transient( $key, ( (int) $current ) + 1, $ttl );
	}
}
