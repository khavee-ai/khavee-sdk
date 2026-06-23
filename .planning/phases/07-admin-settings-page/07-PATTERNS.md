# Phase 7: Admin Settings Page - Pattern Map

**Mapped:** 2026-06-23
**Files analyzed:** 4 (1 new class, 2 modified, 1 new test harness)
**Analogs found:** 4 / 4

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `wordpress-plugin/includes/Admin/SettingsPage.php` | controller (WP admin page) | request-response (form GET/POST via `options.php`) | `wordpress-plugin/includes/Rest/SessionController.php` | role-match (controller wiring concretes via constructor injection, dispatches to a registration hook, returns formatted output) |
| `wordpress-plugin/includes/ConfigSource/ConfigSourceInterface.php` (modified — add `is_configured()`) | service interface (config contract) | CRUD (read-only contract extension) | itself (Phase 6, pre-existing) | exact (additive method on existing interface, same file) |
| `wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php` (modified — implement `is_configured()`, write-path additions, avatar attachment-ID resolution) | service (config read/write) | CRUD | itself (Phase 6, pre-existing) | exact (extending the existing concrete class with new methods/fields, same option shape) |
| `wordpress-plugin/includes/Plugin.php` (modified — wire `SettingsPage` into composition root) | config/bootstrap (composition root) | event-driven (WP action hooks) | itself (Phase 6, pre-existing) | exact (same file, same wiring pattern extended with one more constructed concrete) |
| `wordpress-plugin/khaveeai.php` (modified — none expected; PSR-4 autoload already covers `Admin/`) | config (bootstrap entry point) | event-driven | itself (Phase 6, pre-existing) | exact (no change needed — confirms via composer.json's `psr-4` map) |
| `wordpress-plugin/tests/settings-page-harness.php` (new) | test | batch (standalone PHP test runner) | `wordpress-plugin/tests/rest-logic-harness.php` | exact (same bare-PHP-stub-harness convention, same `run_case()`/fixture-class structure) |

## Pattern Assignments

### `wordpress-plugin/includes/Admin/SettingsPage.php` (controller, request-response)

**Analog:** `wordpress-plugin/includes/Rest/SessionController.php` (for constructor-injection + interface dependency + registration-hook pattern) and the Code Examples skeleton already drafted in `07-RESEARCH.md` (use that skeleton directly — it already follows this codebase's conventions).

**Namespace + imports pattern** (from `SessionController.php` lines 13-18):
```php
namespace Khavee\Plugin\Rest;

use Khavee\Plugin\ConfigSource\ConfigSourceInterface;
use Khavee\Plugin\TokenProvider\TokenProviderInterface;
use Khavee\Plugin\TokenProvider\TokenMintException;
use Khavee\Plugin\RateLimit\RateLimiter;
```
Apply the same shape for the new file:
```php
namespace Khavee\Plugin\Admin;

use Khavee\Plugin\ConfigSource\ConfigSourceInterface;
```

**Constructor-injection pattern** (`SessionController.php` lines 29-59):
```php
final class SessionController {
	private $config_source;
	private $token_provider;
	private $rate_limiter;

	public function __construct(
		ConfigSourceInterface $config_source,
		TokenProviderInterface $token_provider,
		RateLimiter $rate_limiter
	) {
		$this->config_source  = $config_source;
		$this->token_provider = $token_provider;
		$this->rate_limiter   = $rate_limiter;
	}
```
`SettingsPage` takes the single `ConfigSourceInterface $config_source` dependency the same way — depend on the INTERFACE, never construct a concrete `WpOptionsConfigSource` inside `SettingsPage` itself (that stays `Plugin.php`'s job per the composition-root rule).

**Hook-registration pattern** (`SessionController.php` lines 61-85, mirrored by `Plugin.php` line 43):
```php
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
```
For `SettingsPage`, the equivalent is a `register_hooks()` method called from `Plugin::boot()`, registering `admin_menu` and `admin_init` actions (per the RESEARCH.md skeleton):
```php
public function register_hooks(): void {
	add_action( 'admin_menu', [ $this, 'add_menu_page' ] );
	add_action( 'admin_init', [ $this, 'register_settings' ] );
}
```

**Defense-in-depth capability check** (new pattern, not present in Phase 6 since `SessionController`'s route is deliberately public — but the RESEARCH.md skeleton already specifies the exact placement; treat `register_routes()`'s docblock at `SessionController.php` lines 61-74 as the "explain why this auth choice was made" comment-style analog):
```php
public function render_page(): void {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'You do not have permission to access this page.', 'khaveeai' ) );
	}
	// ...
}
```
Comment style: follow `SessionController.php`'s pattern of explaining WHY the security boundary is where it is (lines 64-71), not just what the code does — e.g. document that `add_menu_page()`'s capability arg only hides the menu link (Pitfall 3), so the render callback must independently re-check.

**Error/validation surfacing pattern** — there is no exact analog for `add_settings_error()` in Phase 6 (its errors are HTTP-response-coded, not WP-admin-notice-coded), but the underlying discipline is the same as `SessionController::respond()` (lines 199-204): always go through one centralized formatting path, never inline raw error strings at each call site. Apply that discipline to `sanitize_api_key()`'s `add_settings_error()` call (RESEARCH.md Pattern 2, lines 307-314) — one call site, consistent error-code string (`khaveeai_api_key_invalid_format`), consistent text-domain (`'khaveeai'`).

**Generic-error / no-leak discipline** (`OpenAiDirectTokenProvider.php` lines 7-13, class docblock):
```php
/**
 * Security invariants (D-09, D-10, Backend Proxy Assumption):
 *  - The real API key crosses only in the outbound Authorization header,
 *    never in any value returned to the caller.
 *  - On any OpenAI/network failure, exactly one error_log() line records
 *    the real detail ... the caller-visible failure signal carries no
 *    OpenAI response text, status detail, or key material.
 */
```
Apply the same discipline to the masked-key rendering: never echo the raw key into any HTML attribute — always pass it through `mask_api_key()` first (RESEARCH.md Pattern 2/Anti-Patterns section). This settings page is the PHP-admin-side instance of the exact "never leak the secret" philosophy CLAUDE.md documents for the TS SDK's `error instanceof Error` normalization.

---

### `wordpress-plugin/includes/ConfigSource/ConfigSourceInterface.php` (interface, additive method)

**Analog:** itself — `ConfigSourceInterface.php` (full file, 41 lines, already read in full above).

**Existing interface shape** (lines 18-40):
```php
interface ConfigSourceInterface {

	/**
	 * Public-safe runtime config consumed by the REST response and the JS bundle.
	 *
	 * @return array{instructions: string, voice: string, avatar_url: string, model: string}
	 */
	public function get_runtime_config(): array;

	/**
	 * Server-side-only secret (the OpenAI API key).
	 *
	 * @return string
	 */
	public function get_api_key(): string;
}
```

**Pattern to follow for the new method** (per D-13, additive and backward-compatible — exact text from `07-RESEARCH.md`'s Code Examples section, already conformant to this file's docblock style):
```php
/**
 * Whether the API key has been configured (non-empty). Does NOT
 * verify the key is valid/working — only that one has been entered.
 * Consumed by this phase's own "not configured" banner (D-14) and
 * Phase 8's frontend embed admin-only notice (SET-06/D-12).
 *
 * @return bool
 */
public function is_configured(): bool;
```
Match the existing docblock style exactly: one-sentence summary, blank line, elaboration sentence(s) naming the decision IDs (`D-13`, `D-14`, `SET-06`) that justify the method, `@return` tag. Do not add an `@throws` tag (none of the existing methods have one — this method cannot throw).

---

### `wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php` (concrete service, CRUD — gains write-path + new field + new method)

**Analog:** itself — `WpOptionsConfigSource.php` (full file, 87 lines, already read in full above).

**Constants pattern** (lines 17-49):
```php
final class WpOptionsConfigSource implements ConfigSourceInterface {

	/**
	 * Option name the settings blob is stored under.
	 *
	 * @var string
	 */
	private const OPTION_NAME = 'khaveeai_settings';

	/**
	 * Default instructions when the option is unset or empty.
	 *
	 * Matches OpenAIRealtimeProvider.ts:144's default system instructions.
	 *
	 * @var string
	 */
	private const DEFAULT_INSTRUCTIONS = 'You are a helpful AI assistant.';
```
`SettingsPage.php` MUST reference `WpOptionsConfigSource::OPTION_NAME`-equivalent value (`'khaveeai_settings'`) as its own `OPTION_NAME` constant (see RESEARCH.md skeleton line 431: `private const OPTION_NAME = 'khaveeai_settings'; // Matches WpOptionsConfigSource::OPTION_NAME exactly.`) — duplication is acceptable here since these are two different classes/namespaces with no current shared-constants file, but the comment explaining the must-match invariant is load-bearing; copy that exact comment style.

**Read pattern with defaulting** (lines 54-72):
```php
public function get_runtime_config(): array {
	$settings = get_option( self::OPTION_NAME, [] );

	if ( ! is_array( $settings ) ) {
		$settings = [];
	}

	$instructions = isset( $settings['instructions'] ) ? (string) $settings['instructions'] : '';
	$voice        = isset( $settings['voice'] ) ? (string) $settings['voice'] : '';
	$model        = isset( $settings['model'] ) ? (string) $settings['model'] : '';
	$avatar_url   = isset( $settings['avatar_url'] ) ? (string) $settings['avatar_url'] : '';

	return [
		'instructions' => '' !== $instructions ? $instructions : self::DEFAULT_INSTRUCTIONS,
		'voice'        => '' !== $voice ? $voice : self::DEFAULT_VOICE,
		'avatar_url'   => $avatar_url,
		'model'        => '' !== $model ? $model : self::DEFAULT_MODEL,
	];
}
```
If the plan resolves Open Question 1 (RESEARCH.md) toward attachment-ID storage, this method's `avatar_url` line changes from a direct string read to an `wp_get_attachment_url()` resolution call — same `isset()` guard style, same `(string)`/`(int)` cast discipline, same "default to empty string if absent" fallback (no `DEFAULT_AVATAR_URL` constant exists or should be added — empty is the correct default per the existing pattern).

**`get_api_key()` read pattern** (lines 77-85):
```php
public function get_api_key(): string {
	$settings = get_option( self::OPTION_NAME, [] );

	if ( ! is_array( $settings ) || ! isset( $settings['api_key'] ) ) {
		return '';
	}

	return (string) $settings['api_key'];
}
```
`is_configured()`'s implementation is a one-line composition of this existing method (RESEARCH.md Code Examples, confirmed correct against this exact analog):
```php
public function is_configured(): bool {
	return '' !== $this->get_api_key();
}
```

**Class-level docblock convention to preserve/update** (lines 10-16):
```php
/**
 * Reads the admin-configured settings blob from wp_options.
 *
 * This phase only READS the settings blob; Phase 7's admin settings page
 * sanitizes the blob on write (sanitize_text_field()/sanitize_textarea_field()),
 * so no additional validation is performed here on read.
 */
```
This docblock is now STALE once Phase 7 lands — it explicitly says "this phase only READS." Update it to reflect that `WpOptionsConfigSource` remains read-only from its own perspective (the WRITE path lives in `SettingsPage::sanitize_settings()`, not here) but drop or rephrase the "Phase 7's... settings page" forward-reference now that Phase 7 exists. Keep the substance: this class still does no sanitization itself, trusting the writer (`SettingsPage`) to have already sanitized before `update_option()` is called.

---

### `wordpress-plugin/includes/Plugin.php` (composition root, modified)

**Analog:** itself — `Plugin.php` (full file, 46 lines, already read in full above).

**Existing wiring pattern** (lines 28-45):
```php
final class Plugin {

	public static function boot(): void {
		$config_source  = new WpOptionsConfigSource();
		$token_provider = new OpenAiDirectTokenProvider();
		$rate_limiter   = new RateLimiter();

		$session_controller = new SessionController( $config_source, $token_provider, $rate_limiter );

		add_action( 'rest_api_init', array( $session_controller, 'register_routes' ) );
	}
}
```
Add `SettingsPage` the same way — construct it with the SAME `$config_source` instance already created (do not construct a second `WpOptionsConfigSource`), then call its registration method directly (not via an `add_action` wrapper, since `SettingsPage::register_hooks()` itself calls `add_action()` internally per the RESEARCH.md skeleton — match whichever convention the chosen `SettingsPage` skeleton uses, but DO NOT instantiate two separate config-source instances; one shared instance is the existing convention, e.g. `SessionController` and any future consumer share `$config_source`).

Required import addition (mirrors line 14 `use Khavee\Plugin\Rest\SessionController;`):
```php
use Khavee\Plugin\Admin\SettingsPage;
```

**Docblock pattern to preserve** (lines 16-27, class-level):
```php
/**
 * Constructs the concrete ConfigSource/TokenProvider/RateLimiter
 * strategies, injects them into SessionController via its
 * interface-typed constructor, and registers the REST route.
 *
 * No DI container, no filter-hook-driven strategy selection ...
 */
```
Update this docblock's enumeration to also mention `SettingsPage` once wired, keeping the "no DI container" sentence verbatim (still true).

---

### `wordpress-plugin/khaveeai.php` (bootstrap entry point, likely unmodified)

**Analog:** itself — `khaveeai.php` (full file, 47 lines, already read in full above).

No changes expected. The PSR-4 autoload map (`composer.json`'s `"Khavee\\Plugin\\": "includes/"`) already covers `includes/Admin/SettingsPage.php` → `Khavee\Plugin\Admin\SettingsPage` automatically — confirm this during planning rather than re-deriving it, since `composer.json`'s autoload block (already read) is a flat PSR-4 root mapping with no per-subdirectory entries needed.

---

### `wordpress-plugin/tests/settings-page-harness.php` (new, test, batch)

**Analog:** `wordpress-plugin/tests/rest-logic-harness.php` (full file, 563 lines, already read in full above).

**Harness bootstrap + WP-stub pattern** (lines 1-105):
```php
/**
 * Standalone PHP harness for RateLimiter and SessionController.
 *
 * Runs with bare PHP 8.x — NO WordPress, NO Composer autoloader. Defines
 * minimal global stubs for the WP transient/filter/REST functions these
 * classes use, then exercises: ...
 *
 * Run: php wordpress-plugin/tests/rest-logic-harness.php
 * Exits 0 if all cases pass, non-zero otherwise.
 */
```
For the new harness, stub only what the testable LOGIC needs — per RESEARCH.md's Environment Availability section, the unit-testable surfaces are: `sanitize_api_key()`'s masking/placeholder-detection logic, and the magic-byte check function (`khaveeai_validate_glb_vrm_content()`-equivalent). Both are pure-PHP-logic functions that do NOT require `register_setting()`/`options.php`/`wp.media` stubs — do NOT attempt to stub the full Settings API request lifecycle (RESEARCH.md explicitly flags this as needing a real WP install/`wp-env`, not a bare-PHP harness).

**Direct-require-by-path pattern, no Composer** (lines 165-177):
```php
require __DIR__ . '/../includes/RateLimit/RateLimiter.php';
require __DIR__ . '/../includes/ConfigSource/ConfigSourceInterface.php';
require __DIR__ . '/../includes/TokenProvider/TokenProviderInterface.php';
require __DIR__ . '/../includes/TokenProvider/OpenAiDirectTokenProvider.php';
require __DIR__ . '/../includes/Rest/SessionController.php';

use Khavee\Plugin\RateLimit\RateLimiter;
use Khavee\Plugin\ConfigSource\ConfigSourceInterface;
```
Apply identically: `require __DIR__ . '/../includes/Admin/SettingsPage.php';` plus the `ConfigSourceInterface`/`WpOptionsConfigSource` requires, then `use Khavee\Plugin\Admin\SettingsPage;`.

**`run_case()` + fixture-class pattern** (lines 181-201, 301-347):
```php
$failures = 0;

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

/**
 * Fake ConfigSourceInterface returning a known api key + recognizable
 * runtime config (distinct from anything a "client" stages below).
 */
class FixtureConfigSource implements ConfigSourceInterface {
	private $api_key;

	public function __construct( string $api_key = FIXTURE_API_KEY ) {
		$this->api_key = $api_key;
	}

	public function get_runtime_config(): array { /* ... */ }
	public function get_api_key(): string { return $this->api_key; }
}
```
Reuse this EXACT `run_case()` function and a `FixtureConfigSource`-equivalent (now also implementing `is_configured()` once the interface gains it — every existing/future `ConfigSourceInterface` implementer, including test fixtures, must add the method or fatal on the interface contract). Mirror the `LEAK_MARKER`/no-leak assertion style (lines 203, 438-457, 489-509) if testing that the masked key never appears in rendered HTML output.

**Exit-code convention** (lines 554-562):
```php
if ( $failures > 0 ) {
	echo "\n{$failures} case(s) FAILED.\n";
	exit( 1 );
}

echo "\nAll cases PASSED.\n";
exit( 0 );
```
Copy verbatim.

## Shared Patterns

### Composition Root / Dependency Injection
**Source:** `wordpress-plugin/includes/Plugin.php` (lines 28-45)
**Apply to:** `SettingsPage.php`'s construction and wiring
```php
$config_source  = new WpOptionsConfigSource();
// ... construct other concretes ...
$session_controller = new SessionController( $config_source, $token_provider, $rate_limiter );
add_action( 'rest_api_init', array( $session_controller, 'register_routes' ) );
```
No DI container, no filter-hook-driven strategy selection — `Plugin::boot()` is the ONLY place concretes are instantiated. `SettingsPage` must depend on `ConfigSourceInterface` in its constructor signature, never on `WpOptionsConfigSource` directly.

### PSR-4 Namespace + File Organization
**Source:** `wordpress-plugin/composer.json` (`"Khavee\\Plugin\\": "includes/"`), directory structure (`includes/ConfigSource/`, `includes/Rest/`, `includes/TokenProvider/`, `includes/RateLimit/`)
**Apply to:** New file `includes/Admin/SettingsPage.php` → namespace `Khavee\Plugin\Admin`
```php
namespace Khavee\Plugin\Admin;
```
File-per-class, directory-per-domain — no new `composer.json` entry needed (flat PSR-4 root already covers any subdirectory under `includes/`).

### Defense-in-Depth Capability/Auth Checks with "Why" Comments
**Source:** `wordpress-plugin/includes/Rest/SessionController.php` (lines 61-74, docblock explaining the deliberate public/unauthenticated design)
**Apply to:** `SettingsPage::render_page()`'s `current_user_can('manage_options')` check
```php
/**
 * `permission_callback => '__return_true'` is intentional: this route
 * is deliberately PUBLIC and UNAUTHENTICATED ... The security boundary
 * here is the short-lived, scoped OpenAI ephemeral token itself plus
 * RateLimiter's abuse mitigation below — not route auth.
 */
```
Mirror this density of "why" commentary for the settings page's two-layer capability check (menu registration arg + render-callback re-check) — explain WHY both layers are needed (Pitfall 3: menu capability only hides the link, doesn't block direct navigation), not just restate what the code does.

### Never-Leak-the-Secret Discipline
**Source:** `wordpress-plugin/includes/TokenProvider/OpenAiDirectTokenProvider.php` (lines 7-13, class docblock; lines 66-89, `error_log()`-server-side-only pattern)
**Apply to:** `SettingsPage`'s API key masking/rendering and error surfaces
```php
// Real detail logged server-side only (D-10) — never returned to caller.
error_log( 'khaveeai: OpenAI token mint failed (HTTP ' . $status_code . ')' );
throw new TokenMintException( 'mint_failed' );
```
Settings-page equivalent: never set the raw API key as an HTML `value` attribute; always render `mask_api_key($existing)`'s output. Format-validation failures (D-08) use `add_settings_error()` with a generic, non-leaky message — same philosophy, different transport (WP admin notice vs. HTTP status code).

### Defaulting / Read-with-Fallback Pattern for Option Arrays
**Source:** `wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php` (lines 54-72)
**Apply to:** Any new field read from the `khaveeai_settings` option array (e.g. `avatar_attachment_id`, a future `remove_key` transient flag)
```php
$settings = get_option( self::OPTION_NAME, [] );
if ( ! is_array( $settings ) ) {
	$settings = [];
}
$field = isset( $settings['field_name'] ) ? (string) $settings['field_name'] : '';
```
Always guard with `is_array()` on the option's raw value before indexing into it, always cast to the expected scalar type, always fall back to an empty/zero default rather than throwing or warning.

### Bare-PHP Test Harness (no WP install required)
**Source:** `wordpress-plugin/tests/rest-logic-harness.php` (full file)
**Apply to:** `tests/settings-page-harness.php` for the unit-testable logic (masking comparison, magic-byte check)
```php
function run_case( string $name, callable $fn ): void { /* PASS/FAIL + exit-code tracking */ }
require __DIR__ . '/../includes/Admin/SettingsPage.php';
// stub only the specific WP functions SettingsPage's pure-logic methods call
```
Stub the MINIMUM set of WP functions actually called by the logic under test (e.g. none, if `sanitize_api_key()` is refactored to take the existing key as a plain parameter rather than calling `get_option()` itself — prefer this for testability, matching how `OpenAiDirectTokenProvider::mint_session()` takes `$api_key` as a parameter rather than resolving it internally).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| Avatar upload magic-byte validation logic (`upload_mimes`/`wp_check_filetype_and_ext` filter callbacks) | utility (file-content validator) | file-I/O | No prior file-upload or binary-content-validation code exists anywhere in this codebase (Phase 6 has no upload surface). RESEARCH.md's Pattern 1 code example (lines 196-265 of `07-RESEARCH.md`) is the only available reference — use it directly as the implementation, sourced from official WP hook docs rather than an internal analog. |
| `wp.media` JS frame wiring (`wp_enqueue_media()` + restricted-library-type picker) | N/A (WP-core JS, no custom code) | event-driven (browser) | No JS bundle exists in `wordpress-plugin/` at all (D-01 deliberately avoids one) — this is pure WP-core JS invoked from PHP (`wp_enqueue_media()`), not a pattern this codebase has used before. RESEARCH.md's Standard Stack section is the reference, not an internal analog. |

## Metadata

**Analog search scope:** `wordpress-plugin/includes/` (all 4 existing subdirectories: `ConfigSource/`, `Rest/`, `TokenProvider/`, `RateLimit/`), `wordpress-plugin/khaveeai.php`, `wordpress-plugin/composer.json`, `wordpress-plugin/tests/` (both existing harness files)
**Files scanned:** 9 PHP files read in full (all non-vendor PHP source + both test harnesses)
**Pattern extraction date:** 2026-06-23
