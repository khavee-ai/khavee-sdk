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
 * Record of add_settings_error() calls made during a sanitize run. Reset
 * between cases by khaveeai_test_reset_state(). The sanitize_api_key
 * format-rejection path calls add_settings_error() as a side effect; the
 * cases below assert only on the return value (D-08's add_settings_error is
 * a presentation side-channel, stubbed here so the logic under test can be
 * exercised without a real WP install).
 *
 * @var array<int,array{setting:string,code:string,message:string}>
 */
$GLOBALS['__khaveeai_settings_errors'] = array();

if ( ! function_exists( 'add_settings_error' ) ) {
	/**
	 * Stub for WordPress's add_settings_error(). Records the call so a case
	 * CAN assert it fired if desired; the primary assertion surface for the
	 * sanitize_api_key cases is the return value, not this side effect.
	 *
	 * @param string $setting
	 * @param string $code
	 * @param string $message
	 * @param string $type
	 * @return void
	 */
	function add_settings_error( string $setting, string $code, string $message, string $type = 'error' ): void {
		$GLOBALS['__khaveeai_settings_errors'][] = array(
			'setting' => $setting,
			'code'    => $code,
			'message' => $message,
			'type'    => $type,
		);
	}
}

if ( ! function_exists( '__' ) ) {
	/**
	 * Stub for WordPress's translation function. Returns the text unchanged
	 * — the harness has no translations to load, and the logic under test
	 * cares only about the raw string, not its localization. Mirrors the
	 * "stub only what the logic under test actually calls" convention from
	 * rest-logic-harness.php.
	 *
	 * @param string $text
	 * @param string $domain
	 * @return string
	 */
	function __( string $text, string $domain = 'default' ): string {
		return $text;
	}
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
	$GLOBALS['__khaveeai_option_value']   = array();
	$GLOBALS['__khaveeai_settings_errors'] = array();
}

// ── Load the implementations under test by direct path (no Composer) ──

require __DIR__ . '/../includes/ConfigSource/ConfigSourceInterface.php';
require __DIR__ . '/../includes/ConfigSource/WpOptionsConfigSource.php';
// SettingsPage is added by 07-02 Task 2. Its absence makes the mask/sanitize
// cases below RED until Task 2 creates the class — the intended TDD ordering.
require __DIR__ . '/../includes/Admin/SettingsPage.php';

use Khavee\Plugin\ConfigSource\ConfigSourceInterface;
use Khavee\Plugin\ConfigSource\WpOptionsConfigSource;
use Khavee\Plugin\Admin\SettingsPage;

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

// NOTE: the exit block intentionally sits AFTER every run_case() invocation
// (including the 07-02 mask/sanitize cases below). Do not move it earlier.
// (Currently this block is duplicated at the true end of the file after the
// 07-02 cases; the duplicate below is the live one. This early copy is kept
// only as a marker and never reached if the cases below fatal/exit first.)

// ════════════════════════════════════════════════════════════════════
// mask_api_key + sanitize_api_key cases (07-02 — D-05/D-06/D-07/D-08)
// ════════════════════════════════════════════════════════════════════
//
// These cases are added by 07-02 Task 1 (RED). They require SettingsPage.php,
// which Task 2 creates — so the harness fatals on the require above until
// Task 2 lands, turning these cases RED. That is the intended TDD ordering
// (the plan's <action> explicitly states this).
//
// sanitize_api_key takes ($submitted, $existing, $remove_requested) as plain
// parameters (per 07-02 Task 2's <action>: "signature chosen for pure-function
// testability ... takes existing + remove flag as parameters rather than
// resolving internally"). This mirrors OpenAiDirectTokenProvider::mint_session's
// $api_key-parameter pattern (07-PATTERNS.md) and lets the cases assert on
// masking/sanitize logic WITHOUT constructing a ConfigSourceInterface-backed
// SettingsPage — the harness only needs the class to be loadable.

/**
 * Tiny ConfigSourceInterface fixture for constructing a SettingsPage instance.
 * The mask/sanitize logic under test does not read through it (sanitize_api_key
 * takes $existing as a parameter), so a minimal stub suffices.
 */
final class __KhaveeaiHarnessStubConfig implements ConfigSourceInterface {
	public function get_runtime_config(): array {
		return array( 'instructions' => '', 'voice' => '', 'avatar_url' => '', 'model' => '' );
	}
	public function get_api_key(): string {
		return '';
	}
	public function is_configured(): bool {
		return false;
	}
}

/**
 * Build a SettingsPage whose sanitize_api_key instance method can be called.
 * mask_api_key is static, so the mask cases call it directly on the class.
 *
 * @return SettingsPage
 */
function __khaveeai_build_settings_page() {
	return new SettingsPage( new __KhaveeaiHarnessStubConfig() );
}

// ── Case 7: mask_api_key produces exactly 'sk-••••••<last4>' (D-07) ──

run_case(
	'mask_api_key: returns exactly sk-••••••1234 for sk-abcdefgh1234 (D-07 format)',
	function () {
		return 'sk-••••••1234' === SettingsPage::mask_api_key( 'sk-abcdefgh1234' );
	}
);

// ── Case 8: mask_api_key returns '' for empty input (never leaks a bare mask) ──

run_case(
	'mask_api_key: returns empty string for empty input (never a bare sk-•••••• mask)',
	function () {
		return '' === SettingsPage::mask_api_key( '' );
	}
);

// ── Case 9: sanitize_api_key preserves existing key when submitted equals the mask (D-05) ──

run_case(
	'sanitize_api_key: submitted value === mask(existing) returns existing unchanged (D-05 placeholder-preservation)',
	function () {
		khaveeai_test_reset_state();
		$page     = __khaveeai_build_settings_page();
		$existing = 'sk-prod-live-key-9999';
		$masked   = SettingsPage::mask_api_key( $existing );
		return $existing === $page->sanitize_api_key( $masked, $existing, false );
	}
);

// ── Case 10: sanitize_api_key returns a fresh sk- key trimmed when it is not the mask ──

run_case(
	'sanitize_api_key: a fresh sk- key (not equal to the mask) is returned trimmed',
	function () {
		khaveeai_test_reset_state();
		$page     = __khaveeai_build_settings_page();
		$existing = 'sk-old-key-aaaa';
		// A genuinely new key with surrounding whitespace — must come back trimmed.
		return 'sk-newkey1234' === $page->sanitize_api_key( '  sk-newkey1234  ', $existing, false );
	}
);

// ── Case 11: sanitize_api_key rejects a non-sk- value, returns existing, and records a settings error (D-08) ──

run_case(
	'sanitize_api_key: a non-sk- value returns existing AND registers a settings error (D-08)',
	function () {
		khaveeai_test_reset_state();
		$page     = __khaveeai_build_settings_page();
		$existing = 'sk-keep-this-one-1234';
		$result   = $page->sanitize_api_key( 'notsk-prefixed', $existing, false );
		// Return value must be the existing key (no overwrite with the bad value).
		$return_ok = $existing === $result;
		// And a settings error must have been registered (D-08 surfaces inline).
		$error_fired = ! empty( $GLOBALS['__khaveeai_settings_errors'] );
		return $return_ok && $error_fired;
	}
);

// ── Case 12: sanitize_api_key does NOT treat an emptied field as deletion (D-06) ──
//
// An empty submission that is NOT the mask of an empty existing key must
// return the existing key unchanged. Deletion is a separate, deliberate
// remove_key control (D-06) — never inferred from an emptied field.

run_case(
	'sanitize_api_key: an emptied field is NOT a deletion signal — returns existing unchanged (D-06)',
	function () {
		khaveeai_test_reset_state();
		$page     = __khaveeai_build_settings_page();
		$existing = 'sk-do-not-wipe-0000';
		// An empty/whitespace-only submission, with the remove flag OFF, and an
		// existing key that is NOT empty (so '' is not its own mask). Must keep
		// the existing key, not clear it.
		return $existing === $page->sanitize_api_key( '', $existing, false );
	}
);

// ── Case 13: sanitize_api_key clears the key ONLY when the remove_key flag is set (D-06) ──

run_case(
	'sanitize_api_key: returns empty string only when remove_requested is true (D-06 deliberate removal)',
	function () {
		khaveeai_test_reset_state();
		$page     = __khaveeai_build_settings_page();
		$existing = 'sk-clear-me-5555';
		// With the remove flag ON, the result is '' regardless of the submitted
		// field value — the checkbox is the deletion signal, not the field.
		return '' === $page->sanitize_api_key( SettingsPage::mask_api_key( $existing ), $existing, true );
	}
);

// ════════════════════════════════════════════════════════════════════
// 07-03 cases — magic-byte content validation, MIME allowlist,
// avatar_attachment_id sanitize/remove, 50MB enforcement
// (SET-04/SET-05/ASSET-01, D-09/D-10/D-11)
// ════════════════════════════════════════════════════════════════════
//
// khaveeai_validate_glb_vrm_content() and khaveeai_allow_glb_vrm_mimes()
// are free-standing namespaced functions (filter callbacks registered via
// add_filter with a string callable per 07-RESEARCH.md Pattern 1) — NOT
// class methods. They do not exist yet at the start of this task; the
// require above (SettingsPage.php) loads fine because the class itself
// already exists from 07-02, but these new functions are RED until Task 2
// adds them to SettingsPage.php (same file, free-standing functions defined
// alongside the class). sanitize_avatar_attachment_id() and
// khaveeai_enforce_avatar_size() are public static methods on SettingsPage,
// mirroring 07-02's mask_api_key() static-method testability decision.

/**
 * Write a temp fixture file with the given binary content and return its
 * path. Caller is responsible for unlink()ing it (the cases below do not
 * bother — sys_get_temp_dir() entries are harmless/ephemeral for a CI run).
 *
 * @param string $content
 * @return string Absolute path to the temp file.
 */
function __khaveeai_write_fixture( string $content ): string {
	$path = tempnam( sys_get_temp_dir(), 'khaveeai_fixture_' );
	file_put_contents( $path, $content );
	return $path;
}

// ── Case 14: khaveeai_validate_glb_vrm_content passthrough for non-glb/vrm extensions ──

run_case(
	'khaveeai_validate_glb_vrm_content: passes through unchanged for a non-glb/vrm extension',
	function () {
		$data = array( 'ext' => 'png', 'type' => 'image/png' );
		$file = __khaveeai_write_fixture( 'irrelevant binary content' );
		$result = \Khavee\Plugin\Admin\khaveeai_validate_glb_vrm_content( $data, $file, 'photo.png', array(), 'image/png' );
		return $data === $result;
	}
);

// ── Case 15: khaveeai_validate_glb_vrm_content accepts a valid glTF-magic .glb file ──

run_case(
	'khaveeai_validate_glb_vrm_content: VALID glTF magic bytes + .glb filename -> ext=glb, type=model/gltf-binary',
	function () {
		$file   = __khaveeai_write_fixture( "glTF" . random_bytes( 8 ) );
		$result = \Khavee\Plugin\Admin\khaveeai_validate_glb_vrm_content( array(), $file, 'avatar.glb', array(), 'application/octet-stream' );
		return 'glb' === $result['ext'] && 'model/gltf-binary' === $result['type'];
	}
);

// ── Case 16: khaveeai_validate_glb_vrm_content accepts a valid glTF-magic .vrm file ──

run_case(
	'khaveeai_validate_glb_vrm_content: VALID glTF magic bytes + .vrm filename -> ext=vrm, type=model/gltf-binary',
	function () {
		$file   = __khaveeai_write_fixture( "glTF" . random_bytes( 8 ) );
		$result = \Khavee\Plugin\Admin\khaveeai_validate_glb_vrm_content( array(), $file, 'avatar.vrm', array(), 'application/octet-stream' );
		return 'vrm' === $result['ext'] && 'model/gltf-binary' === $result['type'];
	}
);

// ── Case 17: khaveeai_validate_glb_vrm_content rejects a malicious file renamed to .glb (ASSET-01, T-07C-01) ──

run_case(
	'khaveeai_validate_glb_vrm_content: MALICIOUS renamed file (no glTF magic) -> ext=false, type=false (ASSET-01)',
	function () {
		$file   = __khaveeai_write_fixture( '<?php evil' );
		$result = \Khavee\Plugin\Admin\khaveeai_validate_glb_vrm_content( array(), $file, 'evil.glb', array(), 'application/octet-stream' );
		return false === $result['ext'] && false === $result['type'];
	}
);

// ── Case 18: khaveeai_validate_glb_vrm_content fails closed on an unreadable file ──

run_case(
	'khaveeai_validate_glb_vrm_content: UNREADABLE file (fopen fails) -> ext=false, type=false (fail-closed, not fail-open)',
	function () {
		// A path that cannot exist/open — under a nonexistent directory.
		$nonexistent = sys_get_temp_dir() . '/khaveeai_nonexistent_dir_' . uniqid() . '/unreadable.glb';
		$result = \Khavee\Plugin\Admin\khaveeai_validate_glb_vrm_content( array(), $nonexistent, 'unreadable.glb', array(), 'application/octet-stream' );
		return false === $result['ext'] && false === $result['type'];
	}
);

// ── Case 19: khaveeai_allow_glb_vrm_mimes preserves existing mimes and adds both extensions with the IANA MIME ──

run_case(
	'khaveeai_allow_glb_vrm_mimes: preserves existing mimes, adds glb+vrm -> model/gltf-binary (IANA type)',
	function () {
		$result = \Khavee\Plugin\Admin\khaveeai_allow_glb_vrm_mimes( array( 'png' => 'image/png' ) );
		return isset( $result['png'] ) && 'image/png' === $result['png']
			&& isset( $result['glb'] ) && 'model/gltf-binary' === $result['glb']
			&& isset( $result['vrm'] ) && 'model/gltf-binary' === $result['vrm'];
	}
);

// ── Case 20: sanitize_avatar_attachment_id accepts a positive-int-string submission ──

run_case(
	'sanitize_avatar_attachment_id: a positive int string "123" returns 123',
	function () {
		return 123 === SettingsPage::sanitize_avatar_attachment_id( '123', 0 );
	}
);

// ── Case 21: sanitize_avatar_attachment_id treats "0"/empty as deliberate removal ──

run_case(
	'sanitize_avatar_attachment_id: "0" returns 0 (removal)',
	function () {
		return 0 === SettingsPage::sanitize_avatar_attachment_id( '0', 999 );
	}
);

run_case(
	'sanitize_avatar_attachment_id: empty string returns 0 (removal)',
	function () {
		return 0 === SettingsPage::sanitize_avatar_attachment_id( '', 999 );
	}
);

// ── Case 22: sanitize_avatar_attachment_id never overwrites existing with non-numeric garbage (T-07C-06) ──

run_case(
	'sanitize_avatar_attachment_id: non-numeric garbage returns existing unchanged (T-07C-06)',
	function () {
		return 555 === SettingsPage::sanitize_avatar_attachment_id( 'not-a-number', 555 );
	}
);

// ── Case 23: khaveeai_enforce_avatar_size rejects > 50MB, accepts <= 50MB (D-10) ──

run_case(
	'khaveeai_enforce_avatar_size: rejects a file size greater than 52428800 bytes (50MB, D-10)',
	function () {
		return false === SettingsPage::khaveeai_enforce_avatar_size( 52428801 );
	}
);

run_case(
	'khaveeai_enforce_avatar_size: accepts a file size of exactly 52428800 bytes (50MB boundary, D-10)',
	function () {
		return true === SettingsPage::khaveeai_enforce_avatar_size( 52428800 );
	}
);

run_case(
	'khaveeai_enforce_avatar_size: accepts a file size well under the 50MB limit (D-10)',
	function () {
		return true === SettingsPage::khaveeai_enforce_avatar_size( 1024 );
	}
);

// ── Exit (live — runs after ALL cases, including 07-02's and 07-03's) ──

if ( $failures > 0 ) {
	echo "\n{$failures} case(s) FAILED.\n";
	exit( 1 );
}

echo "\nAll cases PASSED.\n";
exit( 0 );
