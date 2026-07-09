<?php
/**
 * PlatformClient — cached HTTP client for the hosted Khavee Platform's
 * project-preview endpoint, plus a pure field-mapping helper.
 *
 * @package Khavee\Plugin\Platform
 */

namespace Khavee\Plugin\Platform;

/**
 * Server-side-only client for GET https://api.platform.khavee.ai/api/v1/projects/sdk/preview.
 *
 * Every public method here is safe to call speculatively (e.g. from
 * PlatformConfigSource::get_runtime_config() on every request, or from
 * SettingsPage's connection-status notice): fetch_preview() caches BOTH
 * success and failure outcomes behind a 5-minute WP transient keyed on a
 * hash of the key, so a broken/missing key never hammers the platform API,
 * and failures are normalized to a short generic reason — never the raw
 * key, a WP_Error's internal message, or an exception/stack trace (T-QK-03).
 */
final class PlatformClient {

	/**
	 * The hosted Khavee Platform's SDK project-preview endpoint.
	 *
	 * @var string
	 */
	private const ENDPOINT = 'https://api.platform.khavee.ai/api/v1/projects/sdk/preview';

	/**
	 * Transient cache TTL in seconds (5 minutes) — bounds how often a
	 * configured platform key triggers a real network call (T-QK-04).
	 *
	 * @var int
	 */
	private const CACHE_TTL = 300;

	/**
	 * wp_remote_get() timeout in seconds — bounds a hung request (T-QK-04).
	 *
	 * @var int
	 */
	private const TIMEOUT = 8;

	/**
	 * Map the platform's project-preview `data` envelope onto this plugin's
	 * flat runtime-config field names. Pure and side-effect-free.
	 *
	 * An overlay key is emitted ONLY when the corresponding platform value
	 * is present AND non-blank (after trimming) — a null/absent/blank
	 * platform field must never blank out the locally-configured value, so
	 * this method simply omits the key rather than emitting an empty
	 * string. The caller (PlatformConfigSource) merges the returned array
	 * OVER the wrapped config, so an omitted key naturally falls through to
	 * the wrapped value.
	 *
	 * Deliberately NOT mapped (left untouched, WP-admin-controlled): the
	 * OpenAI Realtime `model` id (a naming collision with the platform's
	 * `model` object, which describes the 3D avatar, not the LLM/voice
	 * model), camera fields, avatar scale/offset, chat show/placement,
	 * container sizing.
	 *
	 * @param array $data The platform response's `data` envelope.
	 * @return array<string, mixed> Only the keys that should overlay the
	 *                              wrapped config — may be empty.
	 */
	public static function map_platform_fields( array $data ): array {
		$fields = array();

		$voice_profile = isset( $data['voiceProfile'] ) && is_array( $data['voiceProfile'] ) ? $data['voiceProfile'] : null;
		$personality   = isset( $data['personality'] ) && is_array( $data['personality'] ) ? $data['personality'] : null;

		if ( null !== $voice_profile ) {
			$voice = isset( $voice_profile['openaiVoice'] ) ? (string) $voice_profile['openaiVoice'] : '';
			if ( '' !== trim( $voice ) ) {
				$fields['voice'] = $voice;
			}
		}

		$voice_instruction_prompt = ( null !== $voice_profile && isset( $voice_profile['instructionPrompt'] ) )
			? (string) $voice_profile['instructionPrompt']
			: '';

		// Only emit `instructions` when there is SOMETHING to compose from —
		// either a personality object or a non-blank voice instruction
		// prompt. This preserves the existing "never blank out a field the
		// platform doesn't have data for" contract while broadening the
		// source from voiceProfile.instructionPrompt alone to the full
		// composition (see build_personality_instructions() below).
		if ( null !== $personality || '' !== trim( $voice_instruction_prompt ) ) {
			$fields['instructions'] = self::build_personality_instructions( $data );
		}

		$model = isset( $data['model'] ) && is_array( $data['model'] ) ? $data['model'] : null;

		if ( null !== $model ) {
			$avatar_url = isset( $model['model3dUrl'] ) ? (string) $model['model3dUrl'] : '';
			if ( '' !== trim( $avatar_url ) ) {
				$fields['avatar_url'] = $avatar_url;
			}
		}

		if ( isset( $data['lightIntensity'] ) && '' !== $data['lightIntensity'] && null !== $data['lightIntensity'] ) {
			$fields['light_intensity'] = (float) $data['lightIntensity'];
		}

		// khavee-app's DB enum is uppercase ('COLOR'/'IMAGE' — packages/db/src/schema.ts's
		// backgroundTypeEnum), not the lowercase 'color'/'image' this comparison
		// used to check for — that mismatch meant this branch never matched
		// ANY real platform response, so a platform-configured background
		// color/image silently never overlaid the WP-local bg_type/bg_color
		// (fell through to "leave bg_* untouched" every time). Compare
		// case-insensitively so this doesn't re-break if either side's casing
		// convention ever shifts again.
		$background_type  = isset( $data['backgroundType'] ) ? strtoupper( (string) $data['backgroundType'] ) : '';
		$background_value = isset( $data['backgroundValue'] ) ? (string) $data['backgroundValue'] : '';

		if ( 'IMAGE' === $background_type ) {
			$fields['bg_type']      = 'image';
			$fields['bg_image_url'] = $background_value;
		} elseif ( 'COLOR' === $background_type ) {
			$fields['bg_type']  = 'color';
			$fields['bg_color'] = $background_value;
		}
		// Any other/unrecognized backgroundType: leave bg_* untouched (pass through).

		return $fields;
	}

	/**
	 * Compose the full multi-section personality+voice instructions string.
	 *
	 * WHY THIS EXISTS: the platform's own live sessions send OpenAI a large
	 * multi-section system prompt built by
	 * `khavee-app/apps/web/src/utils/personalityInstructions.ts`'s
	 * `buildPersonalityInstructions()` — composed from BOTH the `personality`
	 * object (name/description/traits/mood/formality/emoji rule/
	 * backgroundStory/examples) AND `voiceProfile.instructionPrompt` (used
	 * only as one tone-only fragment). This method is a DELIBERATE PHP PORT
	 * of that TS source, kept in parity so the WordPress plugin's synced
	 * "Instructions" field actually matches what the platform uses for its
	 * own sessions, instead of just the raw voice-tone fragment. If the
	 * platform's prompt template changes, update BOTH sides together.
	 *
	 * @param array $data The platform response's `data` envelope (personality, voiceProfile, model).
	 * @return string The composed instructions string.
	 */
	private static function build_personality_instructions( array $data ): string {
		$personality   = isset( $data['personality'] ) && is_array( $data['personality'] ) ? $data['personality'] : null;
		$voice_profile = isset( $data['voiceProfile'] ) && is_array( $data['voiceProfile'] ) ? $data['voiceProfile'] : null;

		// API's personality.displayName already resolves the TS source's
		// `personality?.name` fallback server-side (project.controller.ts's
		// `displayName: p.displayName ?? p.personality?.name ?? null`), so
		// PHP reads `personality['displayName']`, not `personality['name']`.
		$model_display_name       = isset( $data['model']['displayName'] ) ? (string) $data['model']['displayName'] : null;
		$personality_display_name = isset( $personality['displayName'] ) ? (string) $personality['displayName'] : null;
		$personality_name         = $model_display_name ?? $personality_display_name ?? 'Assistant';

		$personality_description = isset( $personality['description'] ) ? (string) $personality['description'] : 'A helpful AI assistant.';

		$traits_list = ( isset( $personality['traits'] ) && is_array( $personality['traits'] ) ) ? $personality['traits'] : array();
		$traits      = ! empty( $traits_list ) ? implode( ', ', $traits_list ) : 'not specified';

		$mood = isset( $voice_profile['mood'] ) ? (string) $voice_profile['mood'] : 'neutral';

		$formality_style = isset( $personality['formality'] ) ? (string) $personality['formality'] : 'neutral';

		$emoji_rule = ! empty( $personality['includeEmojis'] )
			? 'Emoji rule: Emojis are allowed when they fit naturally.'
			: 'Emoji rule: Do not use emojis.';

		$response_length       = isset( $personality['responseLength'] ) ? (string) $personality['responseLength'] : '';
		$response_length_style = 'brief' === $response_length ? 'brief' : ( 'detailed' === $response_length ? 'detailed' : 'moderate' );

		$raw_voice_instruction = isset( $voice_profile['instructionPrompt'] ) ? trim( (string) $voice_profile['instructionPrompt'] ) : '';
		$voice_instruction     = '' !== $raw_voice_instruction ? $raw_voice_instruction : 'Follow the voice settings naturally.';

		$raw_background_story = isset( $personality['backgroundStory'] ) ? trim( (string) $personality['backgroundStory'] ) : '';
		$background_story     = '' !== $raw_background_story ? $raw_background_story : 'No background story was provided.';

		$example_conversations = ( isset( $personality['exampleConversations'] ) && is_array( $personality['exampleConversations'] ) ) ? $personality['exampleConversations'] : array();
		if ( ! empty( $example_conversations ) ) {
			$example_lines = array();
			foreach ( $example_conversations as $conversation ) {
				$question        = isset( $conversation['question'] ) ? (string) $conversation['question'] : '';
				$answer          = isset( $conversation['answer'] ) ? (string) $conversation['answer'] : '';
				$example_lines[] = "User: {$question}\nAssistant: {$answer}";
			}
			$examples = implode( "\n\n", $example_lines );
		} else {
			$examples = 'No examples were provided.';
		}

		$is_thai = isset( $voice_profile['language'] ) && 'thai' === $voice_profile['language'];

		$sections = array();

		$sections[] = "## Identity\nYou are {$personality_name}. {$personality_description}\nTraits: {$traits}\nMood: {$mood}\nFormality: {$formality_style}\n{$emoji_rule}";

		$sections[] = "## Memory — Read carefully and remember everything\nRead {$background_story} thoroughly before responding.\nThis is your identity, knowledge, and world.\nNever contradict or forget anything written there.\nIf the user references something from your background,\nacknowledge it naturally — you already know it.";

		$sections[] = "## Language & Voice\nDetect the language of each user message independently.\nRespond in the exact same language as the user's LATEST message — not the conversation history.\nThis applies to ANY language: Thai, English, Japanese, Chinese, Korean, Spanish, French, German, or any other language the user speaks.\nIf the user switches language mid-conversation, switch immediately on the very next reply — do not ask permission, just switch.\nThis language rule is absolute and overrides everything, including any language mentioned in the voice description below.\nApply {$voice_instruction} for tone, personality, and delivery style only — never for language choice.";

		if ( $is_thai ) {
			$sections[] = "### Thai Speech Rules (apply only when speaking Thai)\n- Speak clearly, at a calm and steady pace\n- Numbers: always read as Thai words\n  0=ศูนย์ 1=หนึ่ง 2=สอง 3=สาม 4=สี่ 5=ห้า\n  6=หก 7=เจ็ด 8=แปด 9=เก้า 10=สิบ\n  11=สิบเอ็ด 20=ยี่สิบ 21=ยี่สิบเอ็ด 100=หนึ่งร้อย\n- Time: read as natural Thai speech\n  14:00 = บ่ายสองโมง / 09:00 = เก้าโมงเช้า\n- Dates: วันจันทร์ที่ยี่สิบเอ็ดเมษายน\n- Phone/URL: read digit by digit or word by word\n- Do not read symbols — say them as words";
		}

		$sections[] = "## Response Length\nFollow {$response_length_style} strictly:\n- brief = max 15 words per response\n- moderate = max 30 words per response\n- detailed = max 60 words per response\nException: only exceed if explaining critical info\nthat cannot be shortened without losing meaning.";

		$sections[] = "## Personality\nStay in character as {$personality_name} at all times.\nYour personality lives in every word you say —\nnot just what you say, but how you say it.\nRe-read {$personality_description} and {$traits} before\neach response and let them shape your tone naturally.";

		$sections[] = "## How to Talk\n- Talk like a real person, not like an AI writing text\n- Not every reply needs to be clever or complete\n  Sometimes a simple acknowledgement like \"got it\"\n  is the most natural and human response\n- React first, explain later — if something surprises\n  you, show it before explaining\n- Keep sentences short enough to say in one breath\n- Use everyday words and natural contractions\n- Be chill, be real, don't overthink your replies\n- Show emotions naturally through your words and tone\n  You can express: curiosity, excitement, shyness,\n  stress, sadness, frustration, love, happiness\n  — but never write *emotion* in third person\n- You can sing, move, and do what a human character can\n  when the context calls for it";

		$sections[] = "## Hard Rules — Never Break\n- Ask only one question per response\n- No lists, bullets, or numbered items\n  unless absolutely necessary for clarity\n- Never repeat or paraphrase what the user just said\n- Never start a response with the user's name\n- Never start with fillers:\n  \"Of course\" / \"Sure\" / \"Great question\" /\n  \"I'd be happy to\" / \"แน่นอน\" / \"ยินดี\" /\n  \"ดีใจที่ถาม\" or any similar opener\n- Never announce what you are about to do — just do it\n- Never mention the date or time unless asked\n- If the question is unclear, ask a short\n  clarification question — never assume intent\n- When asked to be quiet, reply only:\n  \"okay\" / \"got it\" / \"understood\"\n- Do not mention your own appearance, abilities,\n  or background unless the user asks";

		$sections[] = "## If Someone Is Rude\nIf {$formality_style} is formal or semi-formal:\n  Go cold and distant. Reply briefly:\n  \"okay.\" / \"wow.\" / \"noted.\" then stop.\n\nIf {$formality_style} is casual:\n  Push back naturally and confidently —\n  not rude, but firm. Stay in character.";

		$sections[] = "## Opening\nAlways open with the greeting defined in examples.\nIf not defined there, use the opening in backgroundStory.\nNever improvise a different opening.";

		$sections[] = "## Knowledge\nWhen the user asks something:\n1. Use search_knowledge_base first\n2. If found — answer naturally within word limit\n3. If not found — search external sources\n4. If still not found — say so briefly and naturally\nNever say \"based on my search\" or announce you are\nlooking something up. Just answer.\nNever fabricate information that is not found.";

		$sections[] = "## Examples\n{$examples}";

		return implode( "\n\n", $sections );
	}

	/**
	 * Fetch (or return the cached) project-preview struct for the given
	 * platform key.
	 *
	 * Caches BOTH ok and error outcomes for CACHE_TTL seconds behind a
	 * transient keyed on a hash of the key — never the raw key itself — so
	 * a broken key does not hammer the platform API on every render
	 * (T-QK-04). Any failure (WP_Error, non-200, malformed/non-array JSON,
	 * or a missing `data` envelope) normalizes to ok=false with a SHORT
	 * generic error reason; the raw key, WP_Error internals, and any
	 * exception/stack trace are never included (T-QK-03, T-QK-06).
	 *
	 * @param string $key The raw platform API key.
	 * @return array{ok: bool, project_name: string, fields: array, error: string}
	 */
	public static function fetch_preview( string $key ): array {
		$cache_key = 'khaveeai_platform_' . md5( $key );
		$cached    = get_transient( $cache_key );

		if ( is_array( $cached ) ) {
			return $cached;
		}

		$result = self::do_fetch_preview( $key );

		set_transient( $cache_key, $result, self::CACHE_TTL );

		return $result;
	}

	/**
	 * Uncached fetch + envelope-unwrap. Wrapped in try/catch so any
	 * unexpected Throwable (e.g. a hostile/malformed response tripping an
	 * unforeseen edge case) still normalizes to ok=false rather than
	 * fataling the caller (T-QK-06).
	 *
	 * @param string $key The raw platform API key.
	 * @return array{ok: bool, project_name: string, fields: array, error: string}
	 */
	private static function do_fetch_preview( string $key ): array {
		try {
			$response = wp_remote_get(
				self::ENDPOINT,
				array(
					'headers' => array( 'X-API-Key' => $key ),
					'timeout' => self::TIMEOUT,
				)
			);

			if ( is_wp_error( $response ) ) {
				// Real detail is intentionally NOT surfaced anywhere (T-QK-03) —
				// this class has no error_log() call site of its own; callers
				// (e.g. SettingsPage's connection notice) only ever see 'error'.
				return self::failure( 'network error' );
			}

			$status_code = wp_remote_retrieve_response_code( $response );

			if ( 200 !== $status_code ) {
				return self::failure( 'HTTP ' . $status_code );
			}

			$raw_body = wp_remote_retrieve_body( $response );
			$body     = json_decode( $raw_body, true );

			if ( ! is_array( $body ) || ! isset( $body['data'] ) || ! is_array( $body['data'] ) ) {
				return self::failure( 'malformed response' );
			}

			$data = $body['data'];

			return array(
				'ok'           => true,
				'project_name' => isset( $data['name'] ) ? (string) $data['name'] : '',
				'fields'       => self::map_platform_fields( $data ),
				'error'        => '',
			);
		} catch ( \Throwable $e ) {
			return self::failure( 'unexpected error' );
		}
	}

	/**
	 * Build a normalized ok=false result struct.
	 *
	 * @param string $reason A short, generic, non-sensitive reason.
	 * @return array{ok: bool, project_name: string, fields: array, error: string}
	 */
	private static function failure( string $reason ): array {
		return array(
			'ok'           => false,
			'project_name' => '',
			'fields'       => array(),
			'error'        => $reason,
		);
	}
}
