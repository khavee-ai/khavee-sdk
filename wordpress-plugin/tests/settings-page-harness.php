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
 * Stub for WordPress's wp_verify_nonce(). Returns truthy ONLY for the
 * literal known-good nonce string "valid-nonce" (regardless of $action),
 * and falsy (0) for everything else — including non-string input, which
 * real wp_verify_nonce() would also reject via its internal hash comparison
 * never matching. This lets the 07-04 CR-02 nonce-gate cases exercise
 * SettingsPage::is_upload_request_allowed()'s pure predicate logic (the
 * fail-closed missing/invalid branches) in bare PHP without a real WP nonce
 * implementation.
 *
 * @param mixed  $nonce
 * @param string $action
 * @return int|false
 */
if ( ! function_exists( 'wp_verify_nonce' ) ) {
	function wp_verify_nonce( $nonce, string $action = '' ) {
		return 'valid-nonce' === $nonce ? 1 : false;
	}
}

/**
 * Stub for WordPress's wp_create_nonce(). Not exercised by any assertion in
 * this harness (render_avatar_field()'s JS-emission side is browser-only),
 * but SettingsPage.php calls it inline in render_avatar_field() — stub it
 * so the class file remains fully loadable in bare PHP without a real WP
 * install. Returns a fixed, recognizable placeholder string.
 *
 * @param string $action
 * @return string
 */
if ( ! function_exists( 'wp_create_nonce' ) ) {
	function wp_create_nonce( string $action = '' ): string {
		return 'stub-nonce-' . $action;
	}
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

if ( ! function_exists( 'sanitize_text_field' ) ) {
	/**
	 * Minimal stub for WordPress's sanitize_text_field(). The real function
	 * strips tags, extra whitespace, and certain control characters; the
	 * 07-04 voice-allowlist cases only need a pass-through-equivalent so
	 * sanitize_settings() is callable in bare PHP — the allowlist check
	 * (in_array against self::VOICES) is the load-bearing logic under test,
	 * not this stub.
	 *
	 * @param string $str
	 * @return string
	 */
	function sanitize_text_field( string $str ): string {
		return trim( $str );
	}
}

if ( ! function_exists( 'sanitize_textarea_field' ) ) {
	/**
	 * Minimal stub for WordPress's sanitize_textarea_field(), needed because
	 * sanitize_settings() (called directly by the 07-04 voice-allowlist
	 * cases) also sanitizes the 'instructions' field. Mirrors
	 * sanitize_text_field()'s pass-through-equivalent stub above.
	 *
	 * @param string $str
	 * @return string
	 */
	function sanitize_textarea_field( string $str ): string {
		return trim( $str );
	}
}

/**
 * Current staged capability map for the current_user_can() stub. Mutated
 * between cases by direct assignment (e.g.
 * $GLOBALS['__khaveeai_current_user_can']['manage_options'] = true). The
 * 07-05 GET-render cases stage this to exercise the pure
 * is_settings_page_render_allowed() predicate's capability gate without a
 * real WP install.
 *
 * @var array<string,bool>
 */
$GLOBALS['__khaveeai_current_user_can'] = array();

/**
 * Current staged HTTP Referer value for the wp_get_referer() stub. Defaults
 * to false (no Referer) — the 07-05 GET-render cases leave it at false,
 * exercising the pure predicate over explicit args rather than via Referer.
 *
 * @var string|false
 */
$GLOBALS['__khaveeai_referer'] = false;

if ( ! function_exists( 'current_user_can' ) ) {
	/**
	 * Stub for WordPress's current_user_can(). Returns the staged boolean for
	 * the requested capability, or false when the capability has not been
	 * explicitly staged (fail-closed — mirrors real WP's behavior for a user
	 * who lacks the capability). The 07-05 GET-render upload_mimes widening
	 * cases use this so the pure predicate is exercised over the same input
	 * shape the runtime instance reader passes it.
	 *
	 * @param string $capability
	 * @return bool
	 */
	function current_user_can( string $capability ): bool {
		return isset( $GLOBALS['__khaveeai_current_user_can'][ $capability ] )
			? (bool) $GLOBALS['__khaveeai_current_user_can'][ $capability ]
			: false;
	}
}

if ( ! function_exists( 'wp_get_referer' ) ) {
	/**
	 * Stub for WordPress's wp_get_referer(). Returns the staged value from
	 * $GLOBALS['__khaveeai_referer'] (or false when unstaged). The 07-05
	 * GET-render cases do NOT depend on Referer — the pure predicate under
	 * test (is_settings_page_render_allowed) takes the page query var and the
	 * capability flag as explicit args — but stubbing wp_get_referer() keeps
	 * SettingsPage.php fully loadable in bare PHP (is_khaveeai_upload_request
	 * calls it) and leaves a staging seam for future cases.
	 *
	 * @return string|false
	 */
	function wp_get_referer() {
		return $GLOBALS['__khaveeai_referer'] ?? false;
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
	$GLOBALS['__khaveeai_option_value']     = array();
	$GLOBALS['__khaveeai_settings_errors']   = array();
	$GLOBALS['__khaveeai_current_user_can']  = array();
	$GLOBALS['__khaveeai_referer']           = false;
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

// ════════════════════════════════════════════════════════════════════
// 07-04 cases — voice allowlist enforcement in sanitize_settings() (CR-01)
// ════════════════════════════════════════════════════════════════════
//
// sanitize_settings() is an instance method that reads $existing_option via
// get_option('khaveeai_settings') (stubbed above) — stage it with
// khaveeai_test_set_option() before calling sanitize_settings(). Each case
// omits 'api_key' from the input so sanitize_api_key()'s own branches (which
// would otherwise call add_settings_error() against the empty-stub api_key)
// don't interfere; assertions are scoped to the returned ['voice'] only.

// ── Case 24: a valid voice (verse) persists unchanged ──

run_case(
	'voice allowlist: a valid voice (verse) persists',
	function () {
		khaveeai_test_reset_state();
		khaveeai_test_set_option( array( 'voice' => 'coral' ) );
		$page   = __khaveeai_build_settings_page();
		$result = $page->sanitize_settings( array( 'voice' => 'verse' ) );
		return 'verse' === $result['voice'];
	}
);

// ── Case 25: an out-of-allowlist voice is rejected, prior voice preserved (CR-01) ──

run_case(
	'voice allowlist: an out-of-allowlist voice is rejected, prior voice preserved (CR-01)',
	function () {
		khaveeai_test_reset_state();
		khaveeai_test_set_option( array( 'voice' => 'coral' ) );
		$page   = __khaveeai_build_settings_page();
		$result = $page->sanitize_settings( array( 'voice' => 'evil-injection' ) );
		// NOT the injected string — the prior stored voice must be preserved.
		return 'coral' === $result['voice'];
	}
);

// ── Case 26: out-of-allowlist voice with no prior stored voice falls back to self::VOICES[0] (alloy) ──

run_case(
	'voice allowlist: out-of-allowlist voice with no prior stored voice falls back to self::VOICES[0] (alloy)',
	function () {
		khaveeai_test_reset_state();
		khaveeai_test_set_option( array() ); // No prior voice key at all.
		$page   = __khaveeai_build_settings_page();
		$result = $page->sanitize_settings( array( 'voice' => 'evil-injection' ) );
		return 'alloy' === $result['voice'];
	}
);

// ── Case 27: an already-poisoned existing voice is normalized to self::VOICES[0]
// rather than re-persisted, even on a submission that doesn't touch voice (CR-01-NEW) ──

run_case(
	'voice allowlist: an already-poisoned existing voice (pre-dating the allowlist check, or written out-of-band) is normalized to self::VOICES[0], never re-persisted (CR-01-NEW)',
	function () {
		khaveeai_test_reset_state();
		// Simulates data written before this check existed, or via WP-CLI/SQL import.
		khaveeai_test_set_option( array( 'voice' => 'evil-injection' ) );
		$page   = __khaveeai_build_settings_page();
		$result = $page->sanitize_settings( array() ); // Submission omits voice entirely.
		return 'alloy' === $result['voice'];
	}
);

// ════════════════════════════════════════════════════════════════════
// 07-04 cases — avatar-upload-filter activation nonce gate (CR-02)
// ════════════════════════════════════════════════════════════════════
//
// is_khaveeai_upload_request() is private (reads $_GET/$_REQUEST/
// wp_get_referer() — WP superglobals/functions this harness cannot
// meaningfully simulate end-to-end), so these cases exercise the public
// static pure helper it delegates to: is_upload_request_allowed(
// bool $page_or_referer_match, $nonce ): bool. The wp_verify_nonce() stub
// above only accepts the literal "valid-nonce" string.

// ── Case 27: page/Referer match AND valid nonce → true ──

run_case(
	'upload nonce gate: page/Referer match AND valid nonce -> true',
	function () {
		return true === SettingsPage::is_upload_request_allowed( true, 'valid-nonce' );
	}
);

// ── Case 28: page/Referer match BUT missing nonce → false (fail-closed, CR-02) ──

run_case(
	'upload nonce gate: page/Referer match BUT missing nonce -> false (fail-closed, CR-02)',
	function () {
		$empty_string_case = false === SettingsPage::is_upload_request_allowed( true, '' );
		$null_case         = false === SettingsPage::is_upload_request_allowed( true, null );
		return $empty_string_case && $null_case;
	}
);

// ── Case 29: page/Referer match BUT invalid nonce → false (fail-closed, CR-02) ──

run_case(
	'upload nonce gate: page/Referer match BUT invalid nonce -> false (fail-closed, CR-02)',
	function () {
		return false === SettingsPage::is_upload_request_allowed( true, 'forged-nonce' );
	}
);

// ── Case 30: no page/Referer match even with a valid nonce → false ──

run_case(
	'upload nonce gate: no page/Referer match even with a valid nonce -> false',
	function () {
		return false === SettingsPage::is_upload_request_allowed( false, 'valid-nonce' );
	}
);

// ════════════════════════════════════════════════════════════════════
// 07-05 cases — GET-render-time upload_mimes registration condition
// (T-07E-01: Plupload's client-side allowlist must widen at GET render)
// ════════════════════════════════════════════════════════════════════
//
// maybe_register_avatar_upload_filters() (SettingsPage.php ~293-303) gates
// ALL THREE filter registrations behind is_khaveeai_upload_request() — a
// nonce-gated POST condition (CR-02). But Plupload builds its client-side
// extension allowlist from get_allowed_mime_types() ONCE at settings-page
// GET render time (wp_plupload_default_settings), and a GET render never
// carries the nonce (it is emitted INTO the page, not sent TO it) — so the
// upload_mimes filter never registered on the GET, glb/vrm never reached
// the Plupload allowlist, and every valid .glb/.vrm upload was rejected
// client-side with "This file cannot be processed by the web server."
// (proven live against wp-env — see .planning/debug/avatar-upload-rejected.md).
//
// Task 2 separates the two filters' registration conditions: upload_mimes
// moves to a manage_options + page-match GET-render condition (so Plupload
// sees glb/vrm at render time), while wp_check_filetype_and_ext (the
// ASSET-01 magic-byte server-side check) STAYS nonce-gated on the POST
// (CR-02, unchanged). These cases exercise the new pure helper that
// encapsulates the GET-render decision:
// is_settings_page_render_allowed( bool $can_manage_options, string $page_query_var ): bool
//
// (Named cases keyed by their shared name-prefix string per the plan's
// instruction — the harness has a pre-existing duplicate 'Case 27' label
// so case NUMBER is not a stable identifier; the name string is.)

// ── Case 31: upload_mimes GET-render condition: manage_options + page match → true ──

run_case(
	'upload_mimes GET-render condition: manage_options + page match -> true (Plupload allowlist widens at render)',
	function () {
		return true === SettingsPage::is_settings_page_render_allowed( true, 'khaveeai-settings' );
	}
);

// ── Case 32: upload_mimes GET-render condition: missing manage_options → false ──

run_case(
	'upload_mimes GET-render condition: missing manage_options -> false (non-admin GET never widens allowlist)',
	function () {
		return false === SettingsPage::is_settings_page_render_allowed( false, 'khaveeai-settings' );
	}
);

// ── Case 33: upload_mimes GET-render condition: wrong/absent page → false ──

run_case(
	'upload_mimes GET-render condition: wrong/absent page -> false (only the settings-page GET widens)',
	function () {
		$empty_page       = false === SettingsPage::is_settings_page_render_allowed( true, '' );
		$wrong_page       = false === SettingsPage::is_settings_page_render_allowed( true, 'some-other-page' );
		return $empty_page && $wrong_page;
	}
);

// ── Exit (live — runs after ALL cases, including 07-02's and 07-03's) ──

if ( $failures > 0 ) {
	echo "\n{$failures} case(s) FAILED.\n";
	exit( 1 );
}

echo "\nAll cases PASSED.\n";
exit( 0 );
