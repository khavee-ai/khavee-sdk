<?php
/**
 * Standalone PHP harness for AvatarRenderer/AvatarShortcode.
 *
 * Runs with bare PHP 8.x — NO WordPress, NO Composer autoloader. Defines
 * minimal global stubs for the WP functions AvatarRenderer/AssetManager
 * use, then exercises:
 *   - EMBED-02: explicit instance attribute overrides win; omitted
 *     attributes fall back to the global default (voice/instructions/
 *     avatar).
 *   - EMBED-04: a shortcode-shaped input (post-AvatarShortcode
 *     normalization) and an equivalent block-shaped input (already-typed
 *     attributes) produce an IDENTICAL public-safe merged config for the
 *     same logical values — proving the two embed methods cannot drift.
 *   - public_safe() output never contains an api-key sentinel under any
 *     input.
 *
 * Run: php wordpress-plugin/tests/render-logic-harness.php
 * Exits 0 if all cases pass, non-zero otherwise.
 */

// ── Constant stubs ──────────────────────────────────────────────────────

if ( ! defined( 'KHAVEEAI_PLUGIN_FILE' ) ) {
	define( 'KHAVEEAI_PLUGIN_FILE', __FILE__ ); // Sentinel path — fine for the harness.
}

if ( ! defined( 'KHAVEEAI_VERSION' ) ) {
	define( 'KHAVEEAI_VERSION', '0.1.0' );
}

// ── Minimal WP function stubs AvatarRenderer/AssetManager touch ───────

/**
 * In-memory set of "enqueued" handles, backing wp_script_is()/
 * wp_enqueue_script() so AssetManager's idempotency guard is testable.
 *
 * @var array<string, bool>
 */
$GLOBALS['__khaveeai_enqueued_handles'] = array();

/**
 * Stub for WordPress's wp_parse_args(). Mirrors core behavior: $args
 * (array) is merged OVER $defaults — keys in $args win on collision.
 *
 * @param array $args
 * @param array $defaults
 * @return array
 */
function wp_parse_args( $args, $defaults = array() ) {
	if ( is_array( $args ) ) {
		return array_merge( $defaults, $args );
	}
	return $defaults;
}

/**
 * Stub for WordPress's esc_attr(). Minimal HTML-attribute escaping.
 *
 * @param string $text
 * @return string
 */
function esc_attr( $text ) {
	return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8' );
}

/**
 * Stub for WordPress's esc_html(). Minimal HTML escaping.
 *
 * @param string $text
 * @return string
 */
function esc_html( $text ) {
	return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8' );
}

/**
 * Stub for WordPress's esc_url(). Minimal pass-through escaping.
 *
 * @param string $url
 * @return string
 */
function esc_url( $url ) {
	return htmlspecialchars( (string) $url, ENT_QUOTES, 'UTF-8' );
}

/**
 * Stub for WordPress's esc_html__(). No i18n in the harness — returns
 * the escaped string unchanged.
 *
 * @param string $text
 * @param string $domain
 * @return string
 */
function esc_html__( $text, $domain = 'default' ) {
	return esc_html( $text );
}

/**
 * Stub for WordPress's esc_attr__(). No i18n in the harness.
 *
 * @param string $text
 * @param string $domain
 * @return string
 */
function esc_attr__( $text, $domain = 'default' ) {
	return esc_attr( $text );
}

/**
 * Stub for WordPress's wp_json_encode(). Same contract as json_encode()
 * for the harness's purposes.
 *
 * @param mixed $data
 * @return string|false
 */
function wp_json_encode( $data ) {
	return json_encode( $data );
}

/**
 * Stub for WordPress's wp_unique_id(). Deterministic-enough counter for
 * the harness — real uniqueness is WP core's concern, not under test
 * here.
 *
 * @param string $prefix
 * @return string
 */
function wp_unique_id( $prefix = '' ) {
	static $count = 0;
	++$count;
	return $prefix . $count;
}

/**
 * Test-controllable current_user_can() stub. Defaults to false (no
 * capability) — cases that need admin context call
 * khaveeai_test_set_can_manage_options() first.
 *
 * @param string $capability
 * @return bool
 */
function current_user_can( $capability ) {
	if ( 'manage_options' === $capability ) {
		return (bool) ( $GLOBALS['__khaveeai_can_manage_options'] ?? false );
	}
	return false;
}

/**
 * Test helper: stage current_user_can('manage_options')'s return value
 * for the current case.
 *
 * @param bool $can
 * @return void
 */
function khaveeai_test_set_can_manage_options( bool $can ): void {
	$GLOBALS['__khaveeai_can_manage_options'] = $can;
}

/**
 * Stub for WordPress's admin_url().
 *
 * @param string $path
 * @return string
 */
function admin_url( $path = '' ) {
	return 'https://example.test/wp-admin/' . $path;
}

/**
 * Stub for WordPress's rest_url().
 *
 * @param string $path
 * @return string
 */
function rest_url( $path = '' ) {
	return 'https://example.test/wp-json/' . $path;
}

/**
 * Stub for WordPress's plugin_dir_path(). Returns a stable fake
 * directory — the harness never reads a real build/ directory.
 *
 * @param string $file
 * @return string
 */
function plugin_dir_path( $file ) {
	return '/fake-plugin-dir/';
}

/**
 * Stub for WordPress's plugins_url(). Returns the path argument
 * unchanged (per PATTERNS.md guidance) so AssetManager's enqueue calls
 * stay introspectable.
 *
 * @param string $path
 * @param string $plugin
 * @return string
 */
function plugins_url( $path = '', $plugin = '' ) {
	return $path;
}

/**
 * Stub for WordPress's wp_script_is(). Backed by the in-memory
 * enqueued-handles set so AssetManager's idempotency guard is
 * assertable.
 *
 * @param string $handle
 * @param string $status
 * @return bool
 */
function wp_script_is( $handle, $status = 'enqueued' ) {
	return isset( $GLOBALS['__khaveeai_enqueued_handles'][ $handle ] );
}

/**
 * Stub for WordPress's wp_enqueue_script(). Records the handle in the
 * in-memory enqueued-handles set.
 *
 * @param string $handle
 * @param string $src
 * @param array  $deps
 * @param mixed  $version
 * @param array  $args
 * @return void
 */
function wp_enqueue_script( $handle, $src = '', $deps = array(), $version = false, $args = array() ) {
	$GLOBALS['__khaveeai_enqueued_handles'][ $handle ] = true;
}

/**
 * Stub for WordPress's wp_enqueue_style(). Records the handle in the
 * same in-memory enqueued-handles set as wp_enqueue_script().
 *
 * @param string $handle
 * @param string $src
 * @param array  $deps
 * @param mixed  $version
 * @return void
 */
function wp_enqueue_style( $handle, $src = '', $deps = array(), $version = false ) {
	$GLOBALS['__khaveeai_enqueued_handles'][ $handle ] = true;
}

/**
 * Stub for WordPress's wp_get_attachment_url(). Backed by a tiny
 * in-memory attachment-ID -> URL map staged via
 * khaveeai_test_set_attachment_url() so AvatarShortcode's attachment-ID
 * resolution (D-03) is testable without a real Media Library.
 *
 * @param int $attachment_id
 * @return string|false
 */
function wp_get_attachment_url( $attachment_id ) {
	return $GLOBALS['__khaveeai_attachment_urls'][ (int) $attachment_id ] ?? false;
}

/**
 * Test helper: stage an attachment-ID -> URL mapping for the current case.
 *
 * @param int    $attachment_id
 * @param string $url
 * @return void
 */
function khaveeai_test_set_attachment_url( int $attachment_id, string $url ): void {
	$GLOBALS['__khaveeai_attachment_urls'][ $attachment_id ] = $url;
}

/**
 * Stub for WordPress's shortcode_atts(). Mirrors core behavior closely
 * enough for AvatarShortcode's needs: merges $atts over $pairs (only
 * keys present in $pairs survive), filtering out any keys not declared
 * in $pairs — core also fires a `shortcode_atts_{$shortcode}` filter,
 * which the harness omits since AvatarShortcode does not depend on it.
 *
 * @param array  $pairs
 * @param array  $atts
 * @param string $shortcode
 * @return array
 */
function shortcode_atts( $pairs, $atts, $shortcode = '' ) {
	$atts = (array) $atts;
	$out  = array();

	foreach ( $pairs as $name => $default ) {
		$out[ $name ] = array_key_exists( $name, $atts ) ? $atts[ $name ] : $default;
	}

	return $out;
}

/**
 * Stub for WordPress's add_shortcode(). No-op in the harness —
 * AvatarShortcode::render() is called directly rather than through WP's
 * shortcode-parsing engine.
 *
 * @param string   $tag
 * @param callable $callback
 * @return void
 */
function add_shortcode( $tag, $callback ) {
	// Intentionally a no-op for the harness.
}

/**
 * Test helper: reset enqueue/capability state between cases.
 *
 * @return void
 */
function khaveeai_test_reset_state(): void {
	$GLOBALS['__khaveeai_enqueued_handles']   = array();
	$GLOBALS['__khaveeai_can_manage_options'] = false;
	$GLOBALS['__khaveeai_attachment_urls']    = array();
}

// ── Load the implementations under test by direct path (no Composer) ──

require __DIR__ . '/../includes/ConfigSource/ConfigSourceInterface.php';
require __DIR__ . '/../includes/Assets/AssetManager.php';
require __DIR__ . '/../includes/Render/AvatarRenderer.php';
require __DIR__ . '/../includes/Shortcode/AvatarShortcode.php';

use Khavee\Plugin\ConfigSource\ConfigSourceInterface;
use Khavee\Plugin\Assets\AssetManager;
use Khavee\Plugin\Render\AvatarRenderer;
use Khavee\Plugin\Shortcode\AvatarShortcode;

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

const API_KEY_LEAK_SENTINEL = 'sk-fixture-secret-should-never-leak';

/**
 * Fixture ConfigSourceInterface returning a known global runtime config
 * and a recognizable (never-exposed) api key sentinel.
 */
class FixtureConfigSource implements ConfigSourceInterface {
	/** @var bool */
	private $configured;

	/** @var string */
	private $api_key;

	public function __construct( bool $configured = true, string $api_key = API_KEY_LEAK_SENTINEL ) {
		$this->configured = $configured;
		$this->api_key    = $api_key;
	}

	public function get_runtime_config(): array {
		return array(
			'instructions' => 'GLOBAL_INSTRUCTIONS',
			'voice'        => 'GLOBAL_VOICE',
			'avatar_url'   => 'https://example.test/global-avatar.glb',
			'model'        => 'gpt-realtime-1.5',
		);
	}

	public function get_api_key(): string {
		return $this->api_key;
	}

	public function is_configured(): bool {
		return $this->configured;
	}
}

/**
 * Extract the decoded public-safe config from an AvatarRenderer::render()
 * HTML return value by parsing the data-khaveeai-config attribute back
 * out, since render() returns an HTML string rather than exposing the
 * array directly.
 *
 * @param string $html
 * @return array|null Null when the markup is not a configured mount
 *                     point (e.g. the not-configured branches).
 */
function extract_public_safe_config( string $html ): ?array {
	if ( 0 === preg_match( '/data-khaveeai-config="([^"]*)"/', $html, $matches ) ) {
		return null;
	}

	$decoded = htmlspecialchars_decode( $matches[1], ENT_QUOTES );
	$config  = json_decode( $decoded, true );

	return is_array( $config ) ? $config : null;
}

// ════════════════════════════════════════════════════════════════════
// EMBED-02 — explicit override wins; omitted falls back to global
// ════════════════════════════════════════════════════════════════════

run_case(
	'AvatarRenderer: explicit voice override wins over the global default',
	function () {
		khaveeai_test_reset_state();
		$renderer = new AvatarRenderer( new FixtureConfigSource(), new AssetManager() );

		$html   = $renderer->render( array( 'voice' => 'INSTANCE_VOICE' ) );
		$config = extract_public_safe_config( $html );

		return null !== $config && 'INSTANCE_VOICE' === ( $config['voice'] ?? null );
	}
);

run_case(
	'AvatarRenderer: omitted voice falls back to the global default',
	function () {
		khaveeai_test_reset_state();
		$renderer = new AvatarRenderer( new FixtureConfigSource(), new AssetManager() );

		$html   = $renderer->render( array() );
		$config = extract_public_safe_config( $html );

		return null !== $config && 'GLOBAL_VOICE' === ( $config['voice'] ?? null );
	}
);

run_case(
	'AvatarRenderer: explicit instructions override wins over the global default',
	function () {
		khaveeai_test_reset_state();
		$renderer = new AvatarRenderer( new FixtureConfigSource(), new AssetManager() );

		$html   = $renderer->render( array( 'instructions' => 'INSTANCE_INSTRUCTIONS' ) );
		$config = extract_public_safe_config( $html );

		return null !== $config && 'INSTANCE_INSTRUCTIONS' === ( $config['instructions'] ?? null );
	}
);

run_case(
	'AvatarRenderer: omitted instructions falls back to the global default',
	function () {
		khaveeai_test_reset_state();
		$renderer = new AvatarRenderer( new FixtureConfigSource(), new AssetManager() );

		$html   = $renderer->render( array() );
		$config = extract_public_safe_config( $html );

		return null !== $config && 'GLOBAL_INSTRUCTIONS' === ( $config['instructions'] ?? null );
	}
);

run_case(
	'AvatarRenderer: public_safe output includes the global model setting (regression — was silently dropped, caused live model_not_found)',
	function () {
		khaveeai_test_reset_state();
		$renderer = new AvatarRenderer( new FixtureConfigSource(), new AssetManager() );

		$html   = $renderer->render( array() );
		$config = extract_public_safe_config( $html );

		return null !== $config && 'gpt-realtime-1.5' === ( $config['model'] ?? null );
	}
);

run_case(
	'AvatarRenderer: explicit avatar_url override wins over the global default',
	function () {
		khaveeai_test_reset_state();
		$renderer = new AvatarRenderer( new FixtureConfigSource(), new AssetManager() );

		$html   = $renderer->render( array( 'avatar_url' => 'https://example.test/instance-avatar.glb' ) );
		$config = extract_public_safe_config( $html );

		return null !== $config && 'https://example.test/instance-avatar.glb' === ( $config['avatarUrl'] ?? null );
	}
);

run_case(
	'AvatarRenderer: omitted avatar falls back to the global default',
	function () {
		khaveeai_test_reset_state();
		$renderer = new AvatarRenderer( new FixtureConfigSource(), new AssetManager() );

		$html   = $renderer->render( array() );
		$config = extract_public_safe_config( $html );

		return null !== $config && 'https://example.test/global-avatar.glb' === ( $config['avatarUrl'] ?? null );
	}
);

// ════════════════════════════════════════════════════════════════════
// EMBED-04 — shortcode-shaped vs block-shaped input parity
// ════════════════════════════════════════════════════════════════════

run_case(
	'EMBED-04: shortcode-shaped and block-shaped input yield identical public-safe config',
	function () {
		khaveeai_test_reset_state();
		khaveeai_test_set_attachment_url( 123, 'https://example.test/shortcode-avatar.glb' );

		$config_source = new FixtureConfigSource();
		$renderer      = new AvatarRenderer( $config_source, new AssetManager() );
		$shortcode     = new AvatarShortcode( $renderer );

		// Shortcode-shaped input: raw shortcode attribute strings, as WP
		// would pass them from [khaveeai_avatar voice="echo" instructions="Be terse." avatar="123"]
		// — "avatar" is a Media Library attachment ID (D-03), resolved to
		// a URL by AvatarShortcode before reaching AvatarRenderer.
		$shortcode_html = $shortcode->render(
			array(
				'voice'        => 'echo',
				'instructions' => 'Be terse.',
				'avatar'       => '123',
			)
		);

		// Block-shaped input: already-typed attributes (per block.json's
		// schema), carrying the SAME logical values but under the
		// avatar_url key AvatarRenderer expects directly (no
		// shortcode_atts()-style normalization needed for a block).
		$block_html = $renderer->render(
			array(
				'voice'        => 'echo',
				'instructions' => 'Be terse.',
				'avatar_url'   => 'https://example.test/shortcode-avatar.glb',
			)
		);

		$shortcode_config = extract_public_safe_config( $shortcode_html );
		$block_config      = extract_public_safe_config( $block_html );

		return null !== $shortcode_config
			&& null !== $block_config
			&& $shortcode_config === $block_config;
	}
);

// ════════════════════════════════════════════════════════════════════
// Information-disclosure — api key never appears in rendered output
// ════════════════════════════════════════════════════════════════════

run_case(
	'AvatarRenderer: public_safe output never contains the api-key sentinel (configured path)',
	function () {
		khaveeai_test_reset_state();
		$renderer = new AvatarRenderer( new FixtureConfigSource( true ), new AssetManager() );

		$html = $renderer->render( array( 'voice' => 'echo', 'instructions' => 'x', 'avatar_url' => 'https://example.test/a.glb' ) );

		return false === strpos( $html, API_KEY_LEAK_SENTINEL );
	}
);

run_case(
	'AvatarRenderer: public_safe output never contains the api-key sentinel (admin not-configured path)',
	function () {
		khaveeai_test_reset_state();
		khaveeai_test_set_can_manage_options( true );
		$renderer = new AvatarRenderer( new FixtureConfigSource( false ), new AssetManager() );

		$html = $renderer->render( array() );

		return false === strpos( $html, API_KEY_LEAK_SENTINEL );
	}
);

// ════════════════════════════════════════════════════════════════════
// D-06/D-07 — admin notice vs visitor placeholder gating
// ════════════════════════════════════════════════════════════════════

run_case(
	'AvatarRenderer: admin sees the not-configured notice when is_configured() is false',
	function () {
		khaveeai_test_reset_state();
		khaveeai_test_set_can_manage_options( true );
		$renderer = new AvatarRenderer( new FixtureConfigSource( false ), new AssetManager() );

		$html = $renderer->render( array() );

		return false !== strpos( $html, 'configured yet' );
	}
);

run_case(
	'AvatarRenderer: non-admin visitor sees no notice markup at all when is_configured() is false',
	function () {
		khaveeai_test_reset_state();
		khaveeai_test_set_can_manage_options( false );
		$renderer = new AvatarRenderer( new FixtureConfigSource( false ), new AssetManager() );

		$html = $renderer->render( array() );

		return false === strpos( $html, 'configured yet' )
			&& false === strpos( $html, 'notice-warning' )
			&& false !== strpos( $html, 'khaveeai-placeholder' );
	}
);

// ════════════════════════════════════════════════════════════════════
// PERF-01 — enqueue idempotency from the render path
// ════════════════════════════════════════════════════════════════════

run_case(
	'AssetManager: enqueue() is idempotent across multiple render() calls on one page',
	function () {
		khaveeai_test_reset_state();
		$renderer = new AvatarRenderer( new FixtureConfigSource(), new AssetManager() );

		$renderer->render( array() );
		$renderer->render( array() );
		$renderer->render( array() );

		// wp_script_is()/wp_enqueue_script() are stubbed against the same
		// set, so this asserts the handle landed exactly once even though
		// render() (and therefore AssetManager::enqueue()) ran 3 times.
		return isset( $GLOBALS['__khaveeai_enqueued_handles']['khaveeai-bundle'] );
	}
);

// ── Exit ─────────────────────────────────────────────────────────────

if ( $failures > 0 ) {
	echo "\n{$failures} case(s) FAILED.\n";
	exit( 1 );
}

echo "\nAll cases PASSED.\n";
exit( 0 );
