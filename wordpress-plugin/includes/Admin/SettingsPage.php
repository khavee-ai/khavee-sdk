<?php
/**
 * SettingsPage — the manage_options-gated wp-admin settings page.
 *
 * Renders a plain WP Settings API form (D-01) on a top-level wp-admin menu
 * item "Khavee AI Avatar" (D-02) with four fields: API key (masked, D-05/
 * D-06/D-07/D-08), personality/instructions textarea (SET-02), voice
 * dropdown (SET-03/D-04), and an avatar picker slot reserved for 07-03
 * (SET-04). The page is the FIRST code path that WRITES the
 * `khaveeai_settings` option blob Phase 6's WpOptionsConfigSource only reads.
 *
 * Security invariants (SET-05, T-07B-01/T-07B-03):
 *  - Capability is checked at TWO layers: the `manage_options` arg passed to
 *    add_menu_page() AND an independent current_user_can('manage_options')
 *    re-check as the FIRST statement of render_page(). The menu arg only
 *    HIDES the link (Pitfall 3); direct navigation to
 *    admin.php?page=khaveeai-settings must also be blocked.
 *  - The stored API key is NEVER placed in any HTML attribute. The key
 *    field's value attribute is always mask_api_key()'s output
 *    (sk-••••••<last4>), never the raw key (T-07B-03).
 *
 * @package Khavee\Plugin\Admin
 */

namespace Khavee\Plugin\Admin;

use Khavee\Plugin\ConfigSource\ConfigSourceInterface;

/**
 * WP Settings API page: top-level menu, register_setting/add_settings_section/
 * add_settings_field, sanitize callbacks (masked-resave for api_key per
 * D-05/D-07/D-08), render callback with defense-in-depth capability check +
 * is_configured() "not configured" banner (D-14).
 */
final class SettingsPage {

	/**
	 * Settings option-group name passed to register_setting()/settings_fields().
	 *
	 * @var string
	 */
	private const OPTION_GROUP = 'khaveeai_settings_group';

	/**
	 * Option name the settings blob is stored under.
	 *
	 * Matches WpOptionsConfigSource::OPTION_NAME exactly.
	 *
	 * @var string
	 */
	private const OPTION_NAME = 'khaveeai_settings';

	/**
	 * The settings page slug (admin.php?page=<slug>).
	 *
	 * @var string
	 */
	private const PAGE_SLUG = 'khaveeai-settings';

	/**
	 * Hardcoded OpenAI Realtime voice enum (D-04 — no live fetch, no preview).
	 *
	 * Source of truth: packages/core/src/types/realtime.ts voice union.
	 *
	 * @var string[]
	 */
	private const VOICES = [
		'alloy',
		'ash',
		'ballad',
		'coral',
		'echo',
		'sage',
		'shimmer',
		'verse',
		'marin',
		'cedar',
	];

	/**
	 * The shared ConfigSourceInterface (is_configured() + get_api_key()
	 * consumed in sanitize/render). Constructor-injected — never construct a
	 * concrete WpOptionsConfigSource here; Plugin.php owns that.
	 *
	 * @var ConfigSourceInterface
	 */
	private $config_source;

	/**
	 * @param ConfigSourceInterface $config_source Shared with SessionController
	 *                                             (Plugin.php wires the same instance).
	 */
	public function __construct( ConfigSourceInterface $config_source ) {
		$this->config_source = $config_source;
	}

	// ── Hook registration ──────────────────────────────────────────────

	/**
	 * Register the admin_menu + admin_init hooks. Called once from
	 * Plugin::boot(); this method itself calls add_action(), so the caller
	 * must NOT wrap register_hooks() in another add_action() call.
	 *
	 * @return void
	 */
	public function register_hooks(): void {
		add_action( 'admin_menu', array( $this, 'add_menu_page' ) );
		add_action( 'admin_init', array( $this, 'register_settings' ) );
	}

	// ── Menu + settings registration ───────────────────────────────────

	/**
	 * Register the top-level wp-admin menu item (D-02). The `manage_options`
	 * capability arg is the FIRST layer of the SET-05 defense-in-depth gate;
	 * render_page() re-checks it independently (Pitfall 3 — menu capability
	 * only hides the link, does not block direct URL navigation).
	 *
	 * @return void
	 */
	public function add_menu_page(): void {
		add_menu_page(
			__( 'Khavee AI Avatar', 'khaveeai' ),
			__( 'Khavee AI Avatar', 'khaveeai' ),
			'manage_options', // D-02/SET-05: capability gate at registration.
			self::PAGE_SLUG,
			array( $this, 'render_page' ),
			'dashicons-microphone'
		);
	}

	/**
	 * Register the setting, its main section, and the non-avatar fields.
	 * The avatar field is added by 07-03 (see the marked insertion point below).
	 *
	 * @return void
	 */
	public function register_settings(): void {
		register_setting(
			self::OPTION_GROUP,
			self::OPTION_NAME,
			array( 'sanitize_callback' => array( $this, 'sanitize_settings' ) )
		);

		add_settings_section(
			'khaveeai_main',
			__( 'Khavee AI Avatar Settings', 'khaveeai' ),
			array( $this, 'render_main_section_intro' ),
			self::PAGE_SLUG
		);

		add_settings_field(
			'api_key',
			__( 'OpenAI API Key', 'khaveeai' ),
			array( $this, 'render_api_key_field' ),
			self::PAGE_SLUG,
			'khaveeai_main'
		);

		add_settings_field(
			'remove_key',
			__( 'Remove Key', 'khaveeai' ),
			array( $this, 'render_remove_key_field' ),
			self::PAGE_SLUG,
			'khaveeai_main'
		);

		add_settings_field(
			'instructions',
			__( 'Personality / Instructions', 'khaveeai' ),
			array( $this, 'render_instructions_field' ),
			self::PAGE_SLUG,
			'khaveeai_main'
		);

		add_settings_field(
			'voice',
			__( 'Voice', 'khaveeai' ),
			array( $this, 'render_voice_field' ),
			self::PAGE_SLUG,
			'khaveeai_main'
		);

		// Avatar field added by 07-03 (SET-04/ASSET-01).
		// Insert the avatar add_settings_field() call here when 07-03 lands.
	}

	// ── Sanitize orchestrator + key sanitize logic ─────────────────────

	/**
	 * Settings API sanitize_callback for the whole khaveeai_settings option.
	 *
	 * Orchestrates per-field sanitization. Reads the existing stored option
	 * for the non-key fields (so an absent field on a partial POST preserves
	 * prior values), resolves the existing api_key via the injected
	 * ConfigSourceInterface, interprets the D-06 remove_key checkbox flag,
	 * and returns the merged sanitized array. NEVER calls update_option()
	 * directly — register_setting()'s returned sanitize_callback value is
	 * what WordPress persists.
	 *
	 * `model` is deliberately NOT written here (D-03) — it remains at
	 * WpOptionsConfigSource::DEFAULT_MODEL, untouched by this page.
	 *
	 * @param array $input Raw submitted option array from options.php.
	 * @return array
	 */
	public function sanitize_settings( array $input ): array {
		$existing_option = get_option( self::OPTION_NAME, array() );
		if ( ! is_array( $existing_option ) ) {
			$existing_option = array();
		}

		$existing_api_key    = $this->config_source->get_api_key();
		$submitted_api_key   = isset( $input['api_key'] ) ? (string) $input['api_key'] : '';
		$remove_requested    = isset( $input['remove_key'] ) && '1' === (string) $input['remove_key'];
		$submitted_instr     = isset( $input['instructions'] ) ? (string) $input['instructions'] : '';
		$submitted_voice     = isset( $input['voice'] ) ? (string) $input['voice'] : '';

		$sanitized = $existing_option; // Preserve any prior keys (e.g. avatar_attachment_id from 07-03, model untouched per D-03).

		$sanitized['api_key']      = $this->sanitize_api_key( $submitted_api_key, $existing_api_key, $remove_requested );
		$sanitized['instructions'] = sanitize_textarea_field( $submitted_instr );
		$sanitized['voice']        = sanitize_text_field( $submitted_voice );

		return $sanitized;
	}

	/**
	 * Mask an API key for redisplay in the form field's value attribute.
	 *
	 * Format (D-07): literal `sk-••••••` prefix + last 4 characters of the key.
	 * Returns '' for empty input so an unconfigured key renders an empty field
	 * rather than a bare `sk-••••••` placeholder that could mislead the admin.
	 *
	 * Static so the test harness can exercise it without constructing a
	 * SettingsPage instance (mirrors OpenAiDirectTokenProvider::mint_session's
	 * parameter-based testability per 07-PATTERNS.md).
	 *
	 * @param string $key The raw stored API key.
	 * @return string The masked string, or '' if $key is empty.
	 */
	public static function mask_api_key( string $key ): string {
		if ( '' === $key ) {
			return '';
		}
		return 'sk-••••••' . substr( $key, -4 ); // D-07: literal SET-01 example format.
	}

	/**
	 * Sanitize a submitted API key value against the masked-placeholder +
	 * format rules (D-05/D-06/D-07/D-08).
	 *
	 * Signature chosen for pure-function testability: takes the existing key
	 * and the remove-request flag as plain parameters rather than resolving
	 * them internally (mirrors OpenAiDirectTokenProvider::mint_session's
	 * $api_key-parameter pattern from 07-PATTERNS.md). This lets the bare-PHP
	 * harness assert on the masking/sanitize logic without a ConfigSource
	 * instance — only the class needs to be loadable.
	 *
	 * Decision order:
	 *  1. D-06: if remove_requested is true, return '' (deliberate removal
	 *     via the separate checkbox — never inferred from an emptied field).
	 *  2. D-05: if the submitted value equals mask_api_key(existing), the
	 *     admin saved the form without touching the key field — return
	 *     existing unchanged so the masked placeholder is not stored.
	 *  3. D-08: a genuinely new value that is empty-after-trim or does not
	 *     start with `sk-` is rejected via add_settings_error() and the
	 *     existing key is kept (no overwrite with a bad value).
	 *  4. Otherwise the new value is valid — return it trimmed.
	 *
	 * @param mixed  $submitted        The raw submitted field value.
	 * @param string $existing         The currently-stored API key.
	 * @param bool   $remove_requested Whether the D-06 remove-key checkbox was checked.
	 * @return string The sanitized key (existing, new, or '' on deliberate removal).
	 */
	public function sanitize_api_key( $submitted, string $existing, bool $remove_requested = false ): string {
		// D-06: deliberate removal via the dedicated checkbox control.
		if ( $remove_requested ) {
			return '';
		}

		$submitted = is_string( $submitted ) ? trim( $submitted ) : '';
		$masked    = self::mask_api_key( $existing );

		// D-05: unchanged masked field → preserve the existing key, don't overwrite.
		if ( $submitted === $masked ) {
			return $existing;
		}

		// D-08: light format check on a genuinely NEW value only.
		if ( '' === $submitted || 0 !== strpos( $submitted, 'sk-' ) ) {
			add_settings_error(
				self::OPTION_NAME,
				'khaveeai_api_key_invalid_format',
				__( 'API key must start with "sk-" and cannot be empty.', 'khaveeai' )
			);
			return $existing; // Reject the bad value — keep the previously stored key.
		}

		return $submitted;
	}

	// ── Render callback + field renderers ──────────────────────────────

	/**
	 * Render the settings page.
	 *
	 * SET-05: the FIRST statement is an independent current_user_can('manage_options')
	 * check. This is defense-in-depth against Pitfall 3: add_menu_page()'s
	 * capability arg only hides the menu link, it does NOT block direct
	 * navigation to admin.php?page=khaveeai-settings. A user who knows the
	 * URL must still be rejected here, independent of the menu registration.
	 *
	 * @return void
	 */
	public function render_page(): void {
		if ( ! current_user_can( 'manage_options' ) ) { // SET-05 layer 2 (Pitfall 3).
			wp_die( esc_html__( 'You do not have permission to access this page.', 'khaveeai' ) );
		}

		// D-14: "not configured" status banner, same is_configured() check
		// Phase 8's frontend embed notice will also consume.
		if ( ! $this->config_source->is_configured() ) {
			echo '<div class="notice notice-warning"><p>' .
				esc_html__( 'Khavee AI Avatar is not yet configured — enter an OpenAI API key below.', 'khaveeai' ) .
				'</p></div>';
		}

		settings_errors( self::OPTION_NAME );

		wp_enqueue_media(); // D-01: loads wp.media JS for the avatar picker (added by 07-03).

		echo '<div class="wrap">';
		echo '<h1>' . esc_html__( 'Khavee AI Avatar', 'khaveeai' ) . '</h1>';
		echo '<form method="post" action="options.php">';
		settings_fields( self::OPTION_GROUP );
		do_settings_sections( self::PAGE_SLUG );
		submit_button();
		echo '</form>';
		echo '</div>';
	}

	/**
	 * Intro text for the main settings section.
	 *
	 * @return void
	 */
	public function render_main_section_intro(): void {
		echo '<p class="description">' .
			esc_html__( 'Configure the OpenAI API key, personality, voice, and avatar for the Khavee AI Avatar embed.', 'khaveeai' ) .
			'</p>';
	}

	/**
	 * Render the masked API key input (SET-01/D-05/D-07).
	 *
	 * The value attribute is ALWAYS mask_api_key()'s output — never the raw
	 * key. An emptied field is NOT a deletion signal (D-06); the separate
	 * remove_key checkbox handles deliberate removal.
	 *
	 * @return void
	 */
	public function render_api_key_field(): void {
		$existing = $this->config_source->get_api_key();
		$masked   = self::mask_api_key( $existing ); // T-07B-03: never echo the raw key.
		printf(
			'<input type="text" id="khaveeai_api_key" name="%s[api_key]" value="%s" class="regular-text" autocomplete="new-password" />',
			esc_attr( self::OPTION_NAME ),
			esc_attr( $masked )
		);
		echo '<p class="description">' .
			esc_html__( 'Enter your OpenAI API key (must start with "sk-"). The saved key is shown masked for security.', 'khaveeai' ) .
			'</p>';
	}

	/**
	 * Render the D-06 "Remove key" checkbox control. Checking this on save
	 * clears the stored key; leaving it unchecked preserves whatever the
	 * sanitize_api_key() placeholder/fresh-key logic decided.
	 *
	 * @return void
	 */
	public function render_remove_key_field(): void {
		printf(
			'<label><input type="checkbox" id="khaveeai_remove_key" name="%s[remove_key]" value="1" /> %s</label>',
			esc_attr( self::OPTION_NAME ),
			esc_html__( 'Clear the saved API key (deliberate removal)', 'khaveeai' )
		);
		echo '<p class="description">' .
			esc_html__( 'Check this box and save to remove the stored API key. An emptied key field alone does NOT clear the key.', 'khaveeai' ) .
			'</p>';
	}

	/**
	 * Render the personality/instructions textarea (SET-02).
	 *
	 * @return void
	 */
	public function render_instructions_field(): void {
		$runtime   = $this->config_source->get_runtime_config();
		$value     = isset( $runtime['instructions'] ) ? (string) $runtime['instructions'] : '';
		printf(
			'<textarea id="khaveeai_instructions" name="%s[instructions]" rows="5" class="large-text">%s</textarea>',
			esc_attr( self::OPTION_NAME ),
			esc_textarea( $value ) // T-07B-07: textarea-specific escaper.
		);
		echo '<p class="description">' .
			esc_html__( 'The system prompt / personality for the AI assistant.', 'khaveeai' ) .
			'</p>';
	}

	/**
	 * Render the voice dropdown (SET-03/D-04). Hardcoded enum, no preview.
	 *
	 * @return void
	 */
	public function render_voice_field(): void {
		$runtime = $this->config_source->get_runtime_config();
		$current = isset( $runtime['voice'] ) ? (string) $runtime['voice'] : '';
		printf( '<select id="khaveeai_voice" name="%s[voice]">', esc_attr( self::OPTION_NAME ) );
		foreach ( self::VOICES as $voice ) {
			printf(
				'<option value="%s"%s>%s</option>',
				esc_attr( $voice ),
				selected( $voice, $current, false ),
				esc_html( $voice )
			);
		}
		echo '</select>';
		echo '<p class="description">' .
			esc_html__( 'The OpenAI Realtime voice the avatar will speak with.', 'khaveeai' ) .
			'</p>';
	}
}
