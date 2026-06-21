<?php
/**
 * Standalone PHP harness for RateLimiter (Task 1) and, appended by Task 2,
 * SessionController logic.
 *
 * Runs with bare PHP 8.x — NO WordPress, NO Composer autoloader. Defines
 * minimal global stubs for the WP transient/filter functions RateLimiter
 * uses, then exercises RateLimiter::is_allowed()/record_mint() against
 * the D-01..D-04 rate-limit/cap rules.
 *
 * Run: php wordpress-plugin/tests/rest-logic-harness.php
 * Exits 0 if all cases pass, non-zero otherwise.
 */

// ── Minimal WP stubs (transients + filters) ────────────────────────────

if ( ! defined( 'MINUTE_IN_SECONDS' ) ) {
	define( 'MINUTE_IN_SECONDS', 60 );
}

if ( ! defined( 'DAY_IN_SECONDS' ) ) {
	define( 'DAY_IN_SECONDS', 86400 );
}

/**
 * In-memory transient store backing get_transient()/set_transient().
 * Flat associative array: key => value. TTLs are accepted but not
 * actually expired by this harness (each test case resets the store).
 *
 * @var array<string, mixed>
 */
$GLOBALS['__khaveeai_transients'] = array();

/**
 * Stub for WordPress's get_transient().
 *
 * @param string $key
 * @return mixed False when unset, matching real WP behavior.
 */
function get_transient( string $key ) {
	return $GLOBALS['__khaveeai_transients'][ $key ] ?? false;
}

/**
 * Stub for WordPress's set_transient(). TTL is accepted for signature
 * compatibility but not enforced by this in-memory harness.
 *
 * @param string $key
 * @param mixed  $value
 * @param int    $ttl
 * @return bool
 */
function set_transient( string $key, $value, int $ttl = 0 ): bool {
	$GLOBALS['__khaveeai_transients'][ $key ] = $value;
	return true;
}

/**
 * Registered filter overrides, keyed by filter tag.
 *
 * @var array<string, mixed>
 */
$GLOBALS['__khaveeai_filters'] = array();

/**
 * Stub for WordPress's apply_filters(). Returns the registered override
 * for $tag if one was staged via khaveeai_test_set_filter(), otherwise
 * the passed-through $default unchanged (matching real WP behavior when
 * no callback is hooked).
 *
 * @param string $tag
 * @param mixed  $default_value
 * @return mixed
 */
function apply_filters( string $tag, $default_value ) {
	if ( array_key_exists( $tag, $GLOBALS['__khaveeai_filters'] ) ) {
		return $GLOBALS['__khaveeai_filters'][ $tag ];
	}
	return $default_value;
}

/**
 * Test helper: stage an apply_filters() override for the current case.
 *
 * @param string $tag
 * @param mixed  $value
 * @return void
 */
function khaveeai_test_set_filter( string $tag, $value ): void {
	$GLOBALS['__khaveeai_filters'][ $tag ] = $value;
}

/**
 * Test helper: reset transients + filters between cases so they don't
 * bleed into each other.
 *
 * @return void
 */
function khaveeai_test_reset_state(): void {
	$GLOBALS['__khaveeai_transients'] = array();
	$GLOBALS['__khaveeai_filters']    = array();
}

// ── Load the implementation under test by direct path (no Composer) ───

require __DIR__ . '/../includes/RateLimit/RateLimiter.php';

use Khavee\Plugin\RateLimit\RateLimiter;

// ── Test harness plumbing ──────────────────────────────────────────────

$failures = 0;

/**
 * @param string   $name
 * @param callable $fn Should return true on pass, false (or throw) on fail.
 */
function run_case( string $name, callable $fn ): void {
	global $failures;
	try {
		$result = $fn();
		if ( true === $result ) {
			echo "PASS: {$name}\n";
		} else {
			echo "FAIL: {$name}\n";
			++$failures;
		}
	} catch ( \Throwable $e ) {
		echo "FAIL: {$name} (unexpected exception: {$e->getMessage()})\n";
		++$failures;
	}
}

// ════════════════════════════════════════════════════════════════════
// Task 1 — RateLimiter cases
// ════════════════════════════════════════════════════════════════════

// ── Case 1: 1st-5th allowed, 6th denied (D-01) ──────────────────────

run_case(
	'RateLimiter: 1st through 5th mint allowed, 6th denied (per-IP limit 5)',
	function () {
		khaveeai_test_reset_state();
		$limiter = new RateLimiter();
		$ip      = '203.0.113.10';

		for ( $i = 1; $i <= 5; $i++ ) {
			if ( ! $limiter->is_allowed( $ip ) ) {
				return false; // Should still be allowed for mints 1-5.
			}
			$limiter->record_mint( $ip );
		}

		// 6th mint from the same IP must now be denied.
		return false === $limiter->is_allowed( $ip );
	}
);

// ── Case 2: sitewide daily cap denies regardless of per-IP count ───

run_case(
	'RateLimiter: sitewide daily cap at 200 denies any mint regardless of per-IP count',
	function () {
		khaveeai_test_reset_state();
		$limiter = new RateLimiter();

		// Seed the daily counter directly at the cap.
		set_transient( 'khaveeai_daily_mints', 200, DAY_IN_SECONDS );

		// A brand-new IP with zero prior mints should still be denied.
		return false === $limiter->is_allowed( '198.51.100.77' );
	}
);

// ── Case 3: a recorded mint increments BOTH counters ────────────────

run_case(
	'RateLimiter: record_mint() increments both the per-IP and sitewide-daily counters',
	function () {
		khaveeai_test_reset_state();
		$limiter = new RateLimiter();
		$ip      = '192.0.2.50';

		$limiter->record_mint( $ip );

		$per_ip_count = get_transient( 'khaveeai_rl_' . $ip );
		$daily_count  = get_transient( 'khaveeai_daily_mints' );

		return 1 === $per_ip_count && 1 === $daily_count;
	}
);

// ── Case 4: filter override changes the allow/deny boundary (D-04) ──

run_case(
	'RateLimiter: khaveeai_rate_limit_per_ip filter overrides the per-IP boundary',
	function () {
		khaveeai_test_reset_state();
		khaveeai_test_set_filter( 'khaveeai_rate_limit_per_ip', 2 );

		$limiter = new RateLimiter();
		$ip      = '203.0.113.99';

		// With the override at 2, only 2 mints should be allowed before denial.
		if ( ! $limiter->is_allowed( $ip ) ) {
			return false;
		}
		$limiter->record_mint( $ip );

		if ( ! $limiter->is_allowed( $ip ) ) {
			return false;
		}
		$limiter->record_mint( $ip );

		// 3rd mint must now be denied under the overridden limit of 2.
		return false === $limiter->is_allowed( $ip );
	}
);

// ── Exit ─────────────────────────────────────────────────────────────

if ( $failures > 0 ) {
	echo "\n{$failures} case(s) FAILED.\n";
	exit( 1 );
}

echo "\nAll cases PASSED.\n";
exit( 0 );
