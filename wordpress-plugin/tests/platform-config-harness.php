<?php
/**
 * Standalone PHP harness for PlatformClient and PlatformConfigSource.
 *
 * Runs with bare PHP 8.x — NO WordPress, NO Composer autoloader. Defines
 * minimal global stubs for the WP options/transient/HTTP API functions these
 * classes use, then exercises:
 *   - PlatformClient::map_platform_fields() — the pure field-mapping table
 *     (voiceProfile.openaiVoice -> voice, personality+voiceProfile -> a
 *     composed multi-section instructions string via
 *     build_personality_instructions(), model -> avatar_url, lightIntensity
 *     -> light_intensity, backgroundType/backgroundValue -> bg_*), including
 *     the "absent/blank platform value must not overlay" rule.
 *   - PlatformClient::fetch_preview() — cached wp_remote_get() + envelope
 *     unwrap, with WP_Error/non-200/malformed-JSON all normalizing to a
 *     short generic ok=false result (never a raw exception/stack trace) and
 *     the transient cache observably preventing a second wp_remote_get()
 *     call for the same key.
 *   - PlatformConfigSource::get_runtime_config() — "platform always wins"
 *     overlay semantics decorating a wrapped ConfigSourceInterface, with a
 *     silent fallback to the wrapped config on any failure (missing key,
 *     WP_Error, non-200, malformed JSON), get_api_key()/is_configured()
 *     delegating straight through untouched, and a sentinel non-leak check.
 *
 * Run: php wordpress-plugin/tests/platform-config-harness.php
 * Exits 0 if all cases pass, non-zero otherwise.
 */

// ── Minimal WP stubs ───────────────────────────────────────────────────

/**
 * Tiny WP_Error stand-in. Only what PlatformClient touches.
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
 * Current staged value of the khaveeai_settings option. Mutated between
 * cases by khaveeai_test_set_option().
 *
 * @var mixed
 */
$GLOBALS['__khaveeai_option_value'] = array();

/**
 * Stub for WordPress's get_option(). Returns the currently-staged value for
 * the khaveeai_settings option name, or the passed $default for any other
 * name — mirrors settings-page-harness.php's convention.
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
 * In-memory transient store backing get_transient()/set_transient() so
 * PlatformClient::fetch_preview()'s caching behavior is observable —
 * mirrors rest-logic-harness.php's convention.
 *
 * @var array<string, mixed>
 */
$GLOBALS['__khaveeai_transients'] = array();

if ( ! function_exists( 'get_transient' ) ) {
	function get_transient( string $key ) {
		return $GLOBALS['__khaveeai_transients'][ $key ] ?? false;
	}
}

if ( ! function_exists( 'set_transient' ) ) {
	function set_transient( string $key, $value, int $ttl = 0 ): bool {
		$GLOBALS['__khaveeai_transients'][ $key ] = $value;
		return true;
	}
}

/**
 * Global fixture driving the next wp_remote_get() stub return value, plus a
 * call-count so cases can assert the transient cache actually prevents a
 * second network call for the same key.
 *
 * @var mixed
 */
$GLOBALS['__khaveeai_remote_fixture']           = null;
$GLOBALS['__khaveeai_wp_remote_get_called']     = false;
$GLOBALS['__khaveeai_wp_remote_get_call_count'] = 0;

/**
 * Stub for WordPress's wp_remote_get(). Ignores $url/$args and returns
 * whatever the current test case staged in $GLOBALS['__khaveeai_remote_fixture'].
 *
 * @param string $url
 * @param array  $args
 * @return mixed
 */
if ( ! function_exists( 'wp_remote_get' ) ) {
	function wp_remote_get( $url, $args = array() ) {
		$GLOBALS['__khaveeai_wp_remote_get_called'] = true;
		++$GLOBALS['__khaveeai_wp_remote_get_call_count'];
		return $GLOBALS['__khaveeai_remote_fixture'];
	}
}

if ( ! function_exists( 'is_wp_error' ) ) {
	function is_wp_error( $thing ): bool {
		return $thing instanceof WP_Error;
	}
}

if ( ! function_exists( 'wp_remote_retrieve_response_code' ) ) {
	function wp_remote_retrieve_response_code( $response ): int {
		if ( is_array( $response ) && isset( $response['response']['code'] ) ) {
			return (int) $response['response']['code'];
		}
		return 0;
	}
}

if ( ! function_exists( 'wp_remote_retrieve_body' ) ) {
	function wp_remote_retrieve_body( $response ): string {
		if ( is_array( $response ) && isset( $response['body'] ) ) {
			return (string) $response['body'];
		}
		return '';
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
 * Test helper: stage a 200/non-200 wp_remote_get() response.
 *
 * @param int    $code
 * @param string $body
 * @return void
 */
function khaveeai_test_stage_remote_response( int $code, string $body ): void {
	$GLOBALS['__khaveeai_remote_fixture'] = array(
		'response' => array( 'code' => $code ),
		'body'     => $body,
	);
}

/**
 * Test helper: stage a WP_Error-shaped wp_remote_get() failure.
 *
 * @param string $message
 * @return void
 */
function khaveeai_test_stage_remote_wp_error( string $message ): void {
	$GLOBALS['__khaveeai_remote_fixture'] = new WP_Error( $message );
}

/**
 * Test helper: reset all staged state between cases so they don't bleed.
 *
 * @return void
 */
function khaveeai_test_reset_platform_state(): void {
	$GLOBALS['__khaveeai_option_value']              = array();
	$GLOBALS['__khaveeai_transients']                = array();
	$GLOBALS['__khaveeai_remote_fixture']             = null;
	$GLOBALS['__khaveeai_wp_remote_get_called']       = false;
	$GLOBALS['__khaveeai_wp_remote_get_call_count']   = 0;
}

// ── Load the implementations under test by direct path (no Composer) ──

require __DIR__ . '/../includes/ConfigSource/ConfigSourceInterface.php';
require __DIR__ . '/../includes/ConfigSource/WpOptionsConfigSource.php';
require __DIR__ . '/../includes/Platform/PlatformClient.php';
require __DIR__ . '/../includes/ConfigSource/PlatformConfigSource.php';

use Khavee\Plugin\ConfigSource\ConfigSourceInterface;
use Khavee\Plugin\ConfigSource\PlatformConfigSource;
use Khavee\Plugin\Platform\PlatformClient;

// ── Test harness plumbing ───────────────────────────────────────────────

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

/**
 * Minimal configurable ConfigSourceInterface fixture standing in for the
 * wrapped WpOptionsConfigSource. get_runtime_config()/get_api_key()/
 * is_configured() each return whatever was staged at construction time, so
 * cases can assert PlatformConfigSource delegates/overlays exactly this
 * fixed shape without depending on WpOptionsConfigSource's own defaults.
 */
final class __PlatformHarnessStubConfig implements ConfigSourceInterface {
	/** @var array */
	private $config;
	/** @var string */
	private $api_key;
	/** @var bool */
	private $configured;

	public function __construct( array $config, string $api_key = 'sk-openai-test-key', bool $configured = true ) {
		$this->config     = $config;
		$this->api_key    = $api_key;
		$this->configured = $configured;
	}

	public function get_runtime_config(): array {
		return $this->config;
	}

	public function get_api_key(): string {
		return $this->api_key;
	}

	public function is_configured(): bool {
		return $this->configured;
	}
}

/**
 * The fixed wrapped-config shape reused across the PlatformConfigSource
 * cases — includes both mappable fields (voice, instructions, avatar_url,
 * light_intensity, bg_type/bg_color) and unmapped fields (model — the
 * OpenAI realtime model id, deliberately NOT overlaid per the naming
 * collision with the platform's 3D-avatar `model` object — plus
 * camera_preset/chat_show) so "unmapped fields equal the wrapped values
 * unchanged" is a meaningful assertion.
 *
 * @return array
 */
function __platform_default_wrapped_config(): array {
	return array(
		'instructions'    => 'Default local instructions',
		'voice'           => 'alloy',
		'avatar_url'      => 'https://example.test/default-avatar.glb',
		'model'           => 'gpt-realtime-1.5',
		'light_intensity' => 1.0,
		'bg_type'         => '',
		'bg_color'        => '',
		'bg_image_url'    => '',
		'camera_preset'   => 'front',
		'chat_show'       => false,
	);
}

// ════════════════════════════════════════════════════════════════════
// PlatformClient::map_platform_fields() — pure field-mapping cases
// ════════════════════════════════════════════════════════════════════

run_case(
	'map_platform_fields: voiceProfile.openaiVoice maps to voice',
	function () {
		$result = PlatformClient::map_platform_fields( array( 'voiceProfile' => array( 'openaiVoice' => 'verse' ) ) );
		return isset( $result['voice'] ) && 'verse' === $result['voice'];
	}
);

run_case(
	'map_platform_fields: absent voiceProfile emits no voice/instructions keys',
	function () {
		$result = PlatformClient::map_platform_fields( array() );
		return ! array_key_exists( 'voice', $result ) && ! array_key_exists( 'instructions', $result );
	}
);

run_case(
	'map_platform_fields: null voiceProfile emits no voice/instructions keys',
	function () {
		$result = PlatformClient::map_platform_fields( array( 'voiceProfile' => null ) );
		return ! array_key_exists( 'voice', $result ) && ! array_key_exists( 'instructions', $result );
	}
);

run_case(
	'map_platform_fields: voiceProfile.instructionPrompt alone composes a full instructions string (not a raw passthrough)',
	function () {
		$result = PlatformClient::map_platform_fields( array( 'voiceProfile' => array( 'instructionPrompt' => 'Be kind and concise.' ) ) );
		if ( ! isset( $result['instructions'] ) ) {
			return false;
		}
		$instructions = $result['instructions'];
		// The voice-tone fragment must be folded into the composition...
		$has_voice_fragment = false !== strpos( $instructions, 'Be kind and concise.' );
		// ...alongside the personality-side defaults (proving composition
		// happened, not a 1:1 passthrough of instructionPrompt).
		$has_default_name   = false !== strpos( $instructions, 'Assistant' );
		$has_default_traits = false !== strpos( $instructions, 'not specified' );
		// And it must NOT be literally equal to the raw instructionPrompt.
		$not_raw_passthrough = 'Be kind and concise.' !== $instructions;

		return $has_voice_fragment && $has_default_name && $has_default_traits && $not_raw_passthrough;
	}
);

run_case(
	'map_platform_fields: full composition with personality + voiceProfile (thai) includes both inputs and the Thai rules section',
	function () {
		$result = PlatformClient::map_platform_fields(
			array(
				'personality'  => array(
					'displayName'          => 'Nong Milk',
					'description'          => 'A cheerful virtual streamer.',
					'traits'               => array( 'playful', 'curious' ),
					'backgroundStory'      => 'Grew up near the river in Ayutthaya.',
					'formality'            => 'casual',
					'includeEmojis'        => true,
					'responseLength'       => 'brief',
					'exampleConversations' => array(
						array(
							'question' => 'Hello!',
							'answer'   => 'Hiii, good to see you!',
						),
					),
				),
				'voiceProfile' => array(
					'instructionPrompt' => 'Speak with a warm, upbeat tone.',
					'language'           => 'thai',
					'mood'               => 'cheerful',
				),
			)
		);

		if ( ! isset( $result['instructions'] ) ) {
			return false;
		}
		$instructions = $result['instructions'];

		return false !== strpos( $instructions, 'Nong Milk' )
			&& false !== strpos( $instructions, 'playful' )
			&& false !== strpos( $instructions, 'Grew up near the river in Ayutthaya.' )
			&& false !== strpos( $instructions, 'Speak with a warm, upbeat tone.' )
			&& false !== strpos( $instructions, 'Thai Speech Rules' );
	}
);

run_case(
	'map_platform_fields: personality present but voiceProfile absent still composes and emits instructions',
	function () {
		$result = PlatformClient::map_platform_fields(
			array(
				'personality' => array(
					'displayName' => 'Solo Personality',
					'traits'      => array( 'calm' ),
				),
			)
		);

		if ( ! isset( $result['instructions'] ) ) {
			return false;
		}
		$instructions = $result['instructions'];

		return false !== strpos( $instructions, 'Solo Personality' )
			&& false !== strpos( $instructions, 'Follow the voice settings naturally.' );
	}
);

run_case(
	'map_platform_fields: neither personality nor voiceProfile present emits no instructions key',
	function () {
		$result = PlatformClient::map_platform_fields( array() );
		return ! array_key_exists( 'instructions', $result );
	}
);

run_case(
	'map_platform_fields: voiceProfile.language=english (non-thai) omits the Thai rules section',
	function () {
		$result = PlatformClient::map_platform_fields(
			array(
				'voiceProfile' => array(
					'instructionPrompt' => 'Speak clearly.',
					'language'           => 'english',
				),
			)
		);

		if ( ! isset( $result['instructions'] ) ) {
			return false;
		}

		return false === strpos( $result['instructions'], 'Thai Speech Rules' );
	}
);

run_case(
	'map_platform_fields: model.model3dUrl maps to avatar_url',
	function () {
		$result = PlatformClient::map_platform_fields( array( 'model' => array( 'model3dUrl' => 'https://x/a.glb' ) ) );
		return isset( $result['avatar_url'] ) && 'https://x/a.glb' === $result['avatar_url'];
	}
);

run_case(
	'map_platform_fields: null model emits no avatar_url key',
	function () {
		$result = PlatformClient::map_platform_fields( array( 'model' => null ) );
		return ! array_key_exists( 'avatar_url', $result );
	}
);

run_case(
	'map_platform_fields: lightIntensity=2.5 maps to light_intensity=2.5',
	function () {
		$result = PlatformClient::map_platform_fields( array( 'lightIntensity' => 2.5 ) );
		return isset( $result['light_intensity'] ) && 2.5 === $result['light_intensity'];
	}
);

run_case(
	'map_platform_fields: absent lightIntensity emits no light_intensity key',
	function () {
		$result = PlatformClient::map_platform_fields( array() );
		return ! array_key_exists( 'light_intensity', $result );
	}
);

run_case(
	'map_platform_fields: backgroundType=image maps bg_type=image + bg_image_url=backgroundValue',
	function () {
		$result = PlatformClient::map_platform_fields(
			array(
				'backgroundType'  => 'image',
				'backgroundValue' => 'https://x/bg.png',
			)
		);
		return isset( $result['bg_type'] ) && 'image' === $result['bg_type']
			&& isset( $result['bg_image_url'] ) && 'https://x/bg.png' === $result['bg_image_url']
			&& ! array_key_exists( 'bg_color', $result );
	}
);

run_case(
	'map_platform_fields: backgroundType=color maps bg_type=color + bg_color=backgroundValue',
	function () {
		$result = PlatformClient::map_platform_fields(
			array(
				'backgroundType'  => 'color',
				'backgroundValue' => '#ff0000',
			)
		);
		return isset( $result['bg_type'] ) && 'color' === $result['bg_type']
			&& isset( $result['bg_color'] ) && '#ff0000' === $result['bg_color']
			&& ! array_key_exists( 'bg_image_url', $result );
	}
);

run_case(
	'map_platform_fields: unrecognized backgroundType (gradient) emits no bg_* keys',
	function () {
		$result = PlatformClient::map_platform_fields(
			array(
				'backgroundType'  => 'gradient',
				'backgroundValue' => 'irrelevant',
			)
		);
		return ! array_key_exists( 'bg_type', $result )
			&& ! array_key_exists( 'bg_color', $result )
			&& ! array_key_exists( 'bg_image_url', $result );
	}
);

run_case(
	'map_platform_fields: blank openaiVoice is treated as absent (not overlaid)',
	function () {
		$result = PlatformClient::map_platform_fields( array( 'voiceProfile' => array( 'openaiVoice' => '' ) ) );
		return ! array_key_exists( 'voice', $result );
	}
);

run_case(
	'map_platform_fields: blank/whitespace-only instructionPrompt is treated as absent (not overlaid)',
	function () {
		$result = PlatformClient::map_platform_fields( array( 'voiceProfile' => array( 'instructionPrompt' => '   ' ) ) );
		return ! array_key_exists( 'instructions', $result );
	}
);

run_case(
	'map_platform_fields: blank model3dUrl is treated as absent (not overlaid)',
	function () {
		$result = PlatformClient::map_platform_fields( array( 'model' => array( 'model3dUrl' => '' ) ) );
		return ! array_key_exists( 'avatar_url', $result );
	}
);

// ════════════════════════════════════════════════════════════════════
// PlatformClient::fetch_preview() — cached HTTP + envelope-unwrap cases
// ════════════════════════════════════════════════════════════════════

run_case(
	'fetch_preview: success returns ok=true, project_name from data.name, mapped fields',
	function () {
		khaveeai_test_reset_platform_state();
		khaveeai_test_stage_remote_response(
			200,
			json_encode(
				array(
					'data' => array(
						'name'         => 'Acme Project',
						'voiceProfile' => array( 'openaiVoice' => 'sage' ),
					),
				)
			)
		);
		$result = PlatformClient::fetch_preview( 'khavee_testkey_fetch1_' . str_repeat( 'a', 64 ) );
		return true === $result['ok']
			&& 'Acme Project' === $result['project_name']
			&& isset( $result['fields']['voice'] ) && 'sage' === $result['fields']['voice'];
	}
);

run_case(
	'fetch_preview: caches the result — a second call for the same key does not re-invoke wp_remote_get',
	function () {
		khaveeai_test_reset_platform_state();
		khaveeai_test_stage_remote_response( 200, json_encode( array( 'data' => array( 'name' => 'Cached Project' ) ) ) );
		$key    = 'khavee_testkey_cache1_' . str_repeat( 'b', 64 );
		$first  = PlatformClient::fetch_preview( $key );
		$count1 = $GLOBALS['__khaveeai_wp_remote_get_call_count'];
		$second = PlatformClient::fetch_preview( $key );
		$count2 = $GLOBALS['__khaveeai_wp_remote_get_call_count'];
		return 1 === $count1 && $count2 === $count1 && $second === $first;
	}
);

run_case(
	'fetch_preview: WP_Error network failure -> ok=false with a short generic reason, no raw message leak',
	function () {
		khaveeai_test_reset_platform_state();
		$leak = 'LEAK_SENTINEL_NETWORK_DETAIL';
		khaveeai_test_stage_remote_wp_error( 'Connection refused: ' . $leak );
		$result = PlatformClient::fetch_preview( 'khavee_testkey_wperror_' . str_repeat( 'c', 64 ) );
		return false === $result['ok'] && false === strpos( $result['error'], $leak );
	}
);

run_case(
	'fetch_preview: non-200 response -> ok=false with a short generic reason, no raw body leak',
	function () {
		khaveeai_test_reset_platform_state();
		$leak = 'LEAK_SENTINEL_BODY_DETAIL';
		khaveeai_test_stage_remote_response( 404, json_encode( array( 'error' => $leak ) ) );
		$result = PlatformClient::fetch_preview( 'khavee_testkey_404_' . str_repeat( 'd', 64 ) );
		return false === $result['ok'] && false === strpos( $result['error'], $leak );
	}
);

run_case(
	'fetch_preview: malformed JSON body -> ok=false, no fatal',
	function () {
		khaveeai_test_reset_platform_state();
		khaveeai_test_stage_remote_response( 200, 'not-json-at-all{{{' );
		$result = PlatformClient::fetch_preview( 'khavee_testkey_malformed_' . str_repeat( 'e', 64 ) );
		return false === $result['ok'];
	}
);

run_case(
	'fetch_preview: 2xx response missing the `data` envelope -> ok=false, no fatal',
	function () {
		khaveeai_test_reset_platform_state();
		khaveeai_test_stage_remote_response( 200, json_encode( array( 'meta' => array() ) ) );
		$result = PlatformClient::fetch_preview( 'khavee_testkey_nodata_' . str_repeat( 'f', 64 ) );
		return false === $result['ok'];
	}
);

// ════════════════════════════════════════════════════════════════════
// PlatformConfigSource::get_runtime_config() — overlay + fallback cases
// ════════════════════════════════════════════════════════════════════

run_case(
	'PlatformConfigSource: no platform key configured -> returns the wrapped config VERBATIM, fetch never invoked',
	function () {
		khaveeai_test_reset_platform_state();
		khaveeai_test_set_option( array() ); // No platform_api_key at all.
		$wrapped = new __PlatformHarnessStubConfig( __platform_default_wrapped_config() );
		$source  = new PlatformConfigSource( $wrapped );
		$result  = $source->get_runtime_config();
		return $result === __platform_default_wrapped_config()
			&& false === $GLOBALS['__khaveeai_wp_remote_get_called'];
	}
);

run_case(
	'PlatformConfigSource: empty-string platform key -> returns the wrapped config VERBATIM, fetch never invoked',
	function () {
		khaveeai_test_reset_platform_state();
		khaveeai_test_set_option( array( 'platform_api_key' => '' ) );
		$wrapped = new __PlatformHarnessStubConfig( __platform_default_wrapped_config() );
		$source  = new PlatformConfigSource( $wrapped );
		$result  = $source->get_runtime_config();
		return $result === __platform_default_wrapped_config()
			&& false === $GLOBALS['__khaveeai_wp_remote_get_called'];
	}
);

run_case(
	'PlatformConfigSource: platform key set AND fetch ok -> mapped fields override, unmapped fields stay wrapped-unchanged',
	function () {
		khaveeai_test_reset_platform_state();
		khaveeai_test_set_option( array( 'platform_api_key' => 'khavee_testkey_overlayok_' . str_repeat( 'g', 64 ) ) );
		khaveeai_test_stage_remote_response(
			200,
			json_encode(
				array(
					'data' => array(
						'name'            => 'Overlay Project',
						'voiceProfile'    => array(
							'openaiVoice'       => 'verse',
							'instructionPrompt' => 'From platform',
						),
						'model'           => array( 'model3dUrl' => 'https://platform.test/avatar.glb' ),
						'lightIntensity'  => 3.0,
						'backgroundType'  => 'color',
						'backgroundValue' => '#00ff00',
					),
				)
			)
		);
		$wrapped = new __PlatformHarnessStubConfig( __platform_default_wrapped_config() );
		$source  = new PlatformConfigSource( $wrapped );
		$result  = $source->get_runtime_config();

		// 'instructions' is now a full composed multi-section string (see
		// PlatformClient::build_personality_instructions()), not a raw
		// passthrough of voiceProfile.instructionPrompt — assert the
		// voice-tone fragment is folded into the composition instead of an
		// exact-string match.
		$mapped_ok = 'verse' === $result['voice']
			&& isset( $result['instructions'] ) && false !== strpos( $result['instructions'], 'From platform' )
			&& 'https://platform.test/avatar.glb' === $result['avatar_url']
			&& 3.0 === $result['light_intensity']
			&& 'color' === $result['bg_type']
			&& '#00ff00' === $result['bg_color'];

		// Unmapped fields (OpenAI model id — deliberately NOT the platform's
		// 3D-avatar `model` object — camera, chat) equal the wrapped values
		// unchanged.
		$unmapped_ok = 'gpt-realtime-1.5' === $result['model']
			&& 'front' === $result['camera_preset']
			&& false === $result['chat_show'];

		return $mapped_ok && $unmapped_ok;
	}
);

run_case(
	'PlatformConfigSource: platform key set BUT fetch fails (WP_Error) -> returns wrapped config VERBATIM, no fatal',
	function () {
		khaveeai_test_reset_platform_state();
		khaveeai_test_set_option( array( 'platform_api_key' => 'khavee_testkey_wperrorcfg_' . str_repeat( 'h', 64 ) ) );
		khaveeai_test_stage_remote_wp_error( 'network failure detail' );
		$wrapped = new __PlatformHarnessStubConfig( __platform_default_wrapped_config() );
		$source  = new PlatformConfigSource( $wrapped );
		$result  = $source->get_runtime_config();
		return $result === __platform_default_wrapped_config();
	}
);

run_case(
	'PlatformConfigSource: platform key set BUT fetch fails (non-200) -> returns wrapped config VERBATIM, no fatal',
	function () {
		khaveeai_test_reset_platform_state();
		khaveeai_test_set_option( array( 'platform_api_key' => 'khavee_testkey_500cfg_' . str_repeat( 'i', 64 ) ) );
		khaveeai_test_stage_remote_response( 500, 'Internal Server Error' );
		$wrapped = new __PlatformHarnessStubConfig( __platform_default_wrapped_config() );
		$source  = new PlatformConfigSource( $wrapped );
		$result  = $source->get_runtime_config();
		return $result === __platform_default_wrapped_config();
	}
);

run_case(
	'PlatformConfigSource: platform key set BUT fetch fails (malformed JSON) -> returns wrapped config VERBATIM, no fatal',
	function () {
		khaveeai_test_reset_platform_state();
		khaveeai_test_set_option( array( 'platform_api_key' => 'khavee_testkey_malformedcfg_' . str_repeat( 'j', 64 ) ) );
		khaveeai_test_stage_remote_response( 200, 'not-json-at-all{{{' );
		$wrapped = new __PlatformHarnessStubConfig( __platform_default_wrapped_config() );
		$source  = new PlatformConfigSource( $wrapped );
		$result  = $source->get_runtime_config();
		return $result === __platform_default_wrapped_config();
	}
);

run_case(
	'PlatformConfigSource: get_api_key() and is_configured() delegate to the wrapped source unchanged',
	function () {
		khaveeai_test_reset_platform_state();
		khaveeai_test_set_option( array( 'platform_api_key' => 'khavee_testkey_delegate_' . str_repeat( 'k', 64 ) ) );
		$wrapped = new __PlatformHarnessStubConfig( __platform_default_wrapped_config(), 'sk-openai-real-key-9999', true );
		$source  = new PlatformConfigSource( $wrapped );
		return 'sk-openai-real-key-9999' === $source->get_api_key()
			&& true === $source->is_configured();
	}
);

run_case(
	'PlatformConfigSource: the platform-key sentinel string never appears anywhere in get_runtime_config() output',
	function () {
		khaveeai_test_reset_platform_state();
		$sentinel = 'khavee_LEAK_SENTINEL_should_never_appear_anywhere';
		khaveeai_test_set_option( array( 'platform_api_key' => $sentinel ) );
		khaveeai_test_stage_remote_response(
			200,
			json_encode(
				array(
					'data' => array(
						'name'         => 'Sentinel Project',
						'voiceProfile' => array( 'openaiVoice' => 'verse' ),
					),
				)
			)
		);
		$wrapped = new __PlatformHarnessStubConfig( __platform_default_wrapped_config() );
		$source  = new PlatformConfigSource( $wrapped );
		$result  = $source->get_runtime_config();
		foreach ( $result as $value ) {
			if ( is_string( $value ) && false !== strpos( $value, $sentinel ) ) {
				return false;
			}
		}
		return true;
	}
);

// ── Exit ─────────────────────────────────────────────────────────────

if ( $failures > 0 ) {
	echo "\n{$failures} case(s) FAILED.\n";
	exit( 1 );
}

echo "\nAll cases PASSED.\n";
exit( 0 );
