<?php
/**
 * Standalone PHP harness for ConfigSourceInterface::is_configured() and
 * WpOptionsConfigSource::get_runtime_config() avatar-resolution logic.
 *
 * Runs with bare PHP 8.x — NO WordPress, NO Composer autoloader. Defines
 * minimal global stubs for the WP functions these classes use (get_option,
 * wp_get_attachment_url), then exercises:
 *   - WpOptionsConfigSource::is_configured() truthiness over get_api_key()
 *     (D-12, D-13) — false when the stored key is empty, true otherwise.
 *   - WpOptionsConfigSource::get_runtime_config()['avatar_url'] resolution
 *     from a stored avatar_attachment_id via wp_get_attachment_url() at read
 *     time (Pattern 3): empty on ID 0/absent, the resolved URL on a valid ID,
 *     and '' (NOT false) when wp_get_attachment_url() returns false for a
 *     stored-but-now-invalid ID (T-07A-02).
 *   - get_runtime_config()'s return-array shape is exactly
 *     {instructions, voice, avatar_url, model}, so Phase 6's SessionController
 *     is unaffected by the internal read-logic change.
 *
 * Run: php wordpress-plugin/tests/settings-page-harness.php
 * Exits 0 if all cases pass, non-zero otherwise.
 */

// ── Minimal WP stubs ──────────────────────────────────────────────────
//
// Stubbed with function_exists() guards so this harness is re-runnable and
// can be composed with other harnesses if a future test runner loads both.
// get_option() returns whatever the current test case stages via
// khaveeai_test_set_option(); wp_get_attachment_url() returns a recognizable
// URL for a known valid ID and false otherwise, matching WP core's
// false-on-miss behavior (T-07A-02 mitigation depends on this contract).

/**
 * Current staged value of the khaveeai_settings option. Mutated between
 * cases by khaveeai_test_set_option().
 *
 * @var mixed
 */
$GLOBALS['__khaveeai_option_value'] = array();

/**
 * Stub for WordPress's get_option(). Returns the currently-staged value
 * for the khaveeai_settings option name, or the passed $default for any
 * other name (so an accidental lookup of a different option still behaves
 * sanely). Mirrors real WP's "return $default when option absent" contract.
 *
 * @param string $name
 * @param mixed  $default
 * @return mixed
 */
if ( ! function_exists( 'get_option' ) ) {
	function get_option( string $name, $default = false ) {
		if ( 'khaveeai_settings' === $name ) {
			return $GLOBALS['__khaveeai_option_value'];
		}
		return $default;
	}
}

/**
 * Stub for WordPress's wp_get_attachment_url(). Returns a recognizable URL
 * for a known valid attachment ID (the VALID_ATTACHMENT_ID constant below),
 * and false for any other/zero/unknown ID — matching real WP's behavior on
 * a missing/deleted attachment. This false-on-miss contract is load-bearing:
 * T-07A-02's coercion-to-'' in WpOptionsConfigSource depends on exercising
 * the false-return path.
 *
 * @param int $attachment_id
 * @return string|false
 */
if ( ! function_exists( 'wp_get_attachment_url' ) ) {
	function wp_get_attachment_url( $attachment_id ) {
		$attachment_id = (int) $attachment_id;
		if ( __khaveeai_test_valid_attachment_id() === $attachment_id ) {
			return 'https://example.test/wp-content/uploads/avatar.glb';
		}
		return false;
	}
}

/**
 * The attachment ID the wp_get_attachment_url() stub treats as valid.
 * Centralized as a helper so a future case can mutate it if needed.
 *
 * @return int
 */
function __khaveeai_test_valid_attachment_id(): int {
	return 7777;
}

/**
 * Test helper: stage the value returned by get_option('khaveeai_settings').
 *
 * @param mixed $value
 * @return void
 */
function khaveeai_test_set_option( $value ): void {
	$GLOBALS['__khaveeai_option_value'] = $value;
}

/**
 * Test helper: reset staged option state between cases so they don't bleed.
 *
 * @return void
 */
function khaveeai_test_reset_state(): void {
	$GLOBALS['__khaveeai_option_value'] = array();
}

// ── Load the implementations under test by direct path (no Composer) ──

require __DIR__ . '/../includes/ConfigSource/ConfigSourceInterface.php';
require __DIR__ . '/../includes/ConfigSource/WpOptionsConfigSource.php';

use Khavee\Plugin\ConfigSource\WpOptionsConfigSource;

// ── Test harness plumbing ──────────────────────────────────────────────
//
// Verbatim run_case()/exit-code convention from rest-logic-harness.php —
// the harness structure this file mirrors exactly.

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
// is_configured() cases (D-12, D-13)
// ════════════════════════════════════════════════════════════════════

// ── Case 1: is_configured() returns false when api_key is absent/empty ──

run_case(
	'is_configured: returns false when api_key is absent from the option blob',
	function () {
		khaveeai_test_reset_state();
		$source = new WpOptionsConfigSource();
		return false === $source->is_configured();
	}
);

// ── Case 2: is_configured() returns true when api_key is a non-empty string ──

run_case(
	'is_configured: returns true when api_key is a non-empty string (sk-test1234)',
	function () {
		khaveeai_test_reset_state();
		khaveeai_test_set_option( array( 'api_key' => 'sk-test1234' ) );
		$source = new WpOptionsConfigSource();
		return true === $source->is_configured();
	}
);

// ════════════════════════════════════════════════════════════════════
// avatar_url resolution cases (Pattern 3, T-07A-02)
// ════════════════════════════════════════════════════════════════════

// ── Case 3: avatar_url is '' when avatar_attachment_id is absent or 0 ──

run_case(
	'avatar_url: resolves to empty string when avatar_attachment_id is absent',
	function () {
		khaveeai_test_reset_state();
		$source = new WpOptionsConfigSource();
		$result = $source->get_runtime_config();
		// Strict check: the absence case must yield '', not null/false.
		return '' === $result['avatar_url'];
	}
);

run_case(
	'avatar_url: resolves to empty string when avatar_attachment_id is 0 (no wp_get_attachment_url(0) call)',
	function () {
		khaveeai_test_reset_state();
		khaveeai_test_set_option( array( 'avatar_attachment_id' => 0 ) );
		$source = new WpOptionsConfigSource();
		$result = $source->get_runtime_config();
		// Strict check: ID 0 must yield '' (gated on $id > 0, so the stub's
		// false-return path is NOT what produces this '' — the guard is).
		return '' === $result['avatar_url'];
	}
);

// ── Case 4: avatar_url equals wp_get_attachment_url() result for a valid ID ──

run_case(
	'avatar_url: equals wp_get_attachment_url() result when avatar_attachment_id is a valid stored ID',
	function () {
		khaveeai_test_reset_state();
		khaveeai_test_set_option( array( 'avatar_attachment_id' => __khaveeai_test_valid_attachment_id() ) );
		$source = new WpOptionsConfigSource();
		$result = $source->get_runtime_config();
		// Strict equality against the exact string the stub returns — proves
		// the read-time resolution path is wired through unchanged.
		return 'https://example.test/wp-content/uploads/avatar.glb' === $result['avatar_url'];
	}
);

// ── Case 5: avatar_url is '' (NOT the literal false) when wp_get_attachment_url() returns false ──
//
// This is the T-07A-02 coercion assertion. A stored-but-now-invalid ID
// (deleted attachment) causes wp_get_attachment_url() to return false;
// WpOptionsConfigSource must coerce that to '' so the avatar_url: string
// return shape stays intact. Deliberately breaking this (returning false
// instead of coercing) would flip this case to FAIL because the assertion
// is strict ('' === $result['avatar_url'], not a loose check).

run_case(
	'avatar_url: coerces a false wp_get_attachment_url() return to empty string, not the literal false (T-07A-02)',
	function () {
		khaveeai_test_reset_state();
		// Stage an attachment ID the stub does NOT recognize → wp_get_attachment_url() returns false.
		khaveeai_test_set_option( array( 'avatar_attachment_id' => 404404 ) );
		$source = new WpOptionsConfigSource();
		$result = $source->get_runtime_config();
		// STRICT check: must be exactly the empty string, not false, not null.
		// If WpOptionsConfigSource leaked the raw false through, this fails.
		return '' === $result['avatar_url'];
	}
);

// ════════════════════════════════════════════════════════════════════
// Shape assertion — Phase 6 SessionController compatibility
// ════════════════════════════════════════════════════════════════════

// ── Case 6: get_runtime_config() returns exactly the keys {instructions, voice, avatar_url, model} ──

run_case(
	'shape: get_runtime_config() returns exactly the keys {instructions, voice, avatar_url, model}',
	function () {
		khaveeai_test_reset_state();
		$source = new WpOptionsConfigSource();
		$result = $source->get_runtime_config();
		$expected_keys = array( 'instructions', 'voice', 'avatar_url', 'model' );
		$actual_keys   = array_keys( $result );
		sort( $expected_keys );
		sort( $actual_keys );
		// Strict key-set equality AND all four values must be strings (no
		// accidental false/null leaking into avatar_url from the read path).
		return $expected_keys === $actual_keys
			&& is_string( $result['instructions'] )
			&& is_string( $result['voice'] )
			&& is_string( $result['avatar_url'] )
			&& is_string( $result['model'] );
	}
);

// ── Exit ─────────────────────────────────────────────────────────────

if ( $failures > 0 ) {
	echo "\n{$failures} case(s) FAILED.\n";
	exit( 1 );
}

echo "\nAll cases PASSED.\n";
exit( 0 );
