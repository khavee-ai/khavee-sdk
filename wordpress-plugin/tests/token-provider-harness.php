<?php
/**
 * Standalone PHP harness for OpenAiDirectTokenProvider::mint_session().
 *
 * Runs with bare PHP 8.x — NO WordPress, NO Composer autoloader. Defines
 * minimal global stubs for the WP HTTP API functions the provider uses,
 * then exercises mint_session() against four stubbed OpenAI responses to
 * prove:
 *   1. Success reshaping: OpenAI's `value` field -> `ephemeralToken` key.
 *   2. Failure normalization on HTTP 500: no leaked OpenAI body text.
 *   3. Failure normalization on WP_Error (network failure): same.
 *   4. Failure normalization on a 2xx response missing `value`: same.
 *
 * Run: php wordpress-plugin/tests/token-provider-harness.php
 * Exits 0 if all four cases pass, non-zero otherwise.
 */

// ── Minimal WP stubs ───────────────────────────────────────────────────

/**
 * Tiny WP_Error stand-in. Only what OpenAiDirectTokenProvider touches.
 */
class WP_Error {
	/** @var string */
	private $message;

	public function __construct( string $message = '' ) {
		$this->message = $message;
	}

	public function get_error_message(): string {
		return $this->message;
	}
}

/**
 * Global fixture driving the next wp_remote_post() stub return value.
 * Each test case sets this before calling mint_session().
 *
 * @var mixed
 */
$GLOBALS['__khaveeai_test_fixture'] = null;

/**
 * Stub for WordPress's wp_remote_post(). Ignores $url/$args and returns
 * whatever the current test case staged in $GLOBALS['__khaveeai_test_fixture'].
 *
 * @param string $url
 * @param array  $args
 * @return mixed
 */
function wp_remote_post( $url, $args = array() ) {
	return $GLOBALS['__khaveeai_test_fixture'];
}

/**
 * Stub for is_wp_error().
 *
 * @param mixed $thing
 * @return bool
 */
function is_wp_error( $thing ): bool {
	return $thing instanceof WP_Error;
}

/**
 * Stub for wp_remote_retrieve_response_code().
 *
 * @param mixed $response
 * @return int
 */
function wp_remote_retrieve_response_code( $response ): int {
	if ( is_array( $response ) && isset( $response['response']['code'] ) ) {
		return (int) $response['response']['code'];
	}
	return 0;
}

/**
 * Stub for wp_remote_retrieve_body().
 *
 * @param mixed $response
 * @return string
 */
function wp_remote_retrieve_body( $response ): string {
	if ( is_array( $response ) && isset( $response['body'] ) ) {
		return (string) $response['body'];
	}
	return '';
}

/**
 * Stub for wp_json_encode() — just defers to json_encode().
 *
 * @param mixed $data
 * @return string|false
 */
function wp_json_encode( $data ) {
	return json_encode( $data );
}

// ── Load the implementation under test by direct path (no Composer) ───

require __DIR__ . '/../includes/TokenProvider/TokenProviderInterface.php';
require __DIR__ . '/../includes/TokenProvider/OpenAiDirectTokenProvider.php';

use Khavee\Plugin\TokenProvider\OpenAiDirectTokenProvider;
use Khavee\Plugin\TokenProvider\TokenMintException;

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

const LEAK_MARKER = 'LEAK_MARKER_SHOULD_NOT_APPEAR';

$provider = new OpenAiDirectTokenProvider();

// ── Case 1: 2xx success — value -> ephemeralToken, session.id -> sessionId ──

run_case(
	'2xx success reshapes value -> ephemeralToken',
	function () use ( $provider ) {
		$GLOBALS['__khaveeai_test_fixture'] = array(
			'response' => array( 'code' => 200 ),
			'body'     => json_encode(
				array(
					'value'   => 'ek_test123',
					'session' => array( 'id' => 'sess_abc' ),
				)
			),
		);

		$result = $provider->mint_session( array(), 'sk-fake-key' );

		return 'ek_test123' === $result['ephemeralToken']
			&& 'sess_abc' === $result['sessionId'];
	}
);

// ── Case 2: HTTP 500 — normalized failure, no leaked body text ─────────

run_case(
	'HTTP 500 surfaces normalized failure with no leaked body text',
	function () use ( $provider ) {
		$GLOBALS['__khaveeai_test_fixture'] = array(
			'response' => array( 'code' => 500 ),
			'body'     => json_encode( array( 'error' => array( 'message' => LEAK_MARKER ) ) ),
		);

		try {
			$provider->mint_session( array(), 'sk-fake-key' );
			return false; // Should have thrown.
		} catch ( TokenMintException $e ) {
			return false === strpos( $e->getMessage(), LEAK_MARKER );
		}
	}
);

// ── Case 3: WP_Error (network failure) — same normalized failure ───────

run_case(
	'WP_Error surfaces normalized failure with no leaked detail',
	function () use ( $provider ) {
		$GLOBALS['__khaveeai_test_fixture'] = new WP_Error( 'Connection timed out: ' . LEAK_MARKER );

		try {
			$provider->mint_session( array(), 'sk-fake-key' );
			return false; // Should have thrown.
		} catch ( TokenMintException $e ) {
			return false === strpos( $e->getMessage(), LEAK_MARKER );
		}
	}
);

// ── Case 4: 2xx with no `value` field — treated as mint failure ────────

run_case(
	'2xx response missing value field surfaces normalized failure',
	function () use ( $provider ) {
		$GLOBALS['__khaveeai_test_fixture'] = array(
			'response' => array( 'code' => 200 ),
			'body'     => json_encode( array( 'session' => array( 'id' => LEAK_MARKER ) ) ),
		);

		try {
			$provider->mint_session( array(), 'sk-fake-key' );
			return false; // Should have thrown.
		} catch ( TokenMintException $e ) {
			return false === strpos( $e->getMessage(), LEAK_MARKER );
		}
	}
);

// ── Exit ─────────────────────────────────────────────────────────────

if ( $failures > 0 ) {
	echo "\n{$failures} case(s) FAILED.\n";
	exit( 1 );
}

echo "\nAll cases PASSED.\n";
exit( 0 );
