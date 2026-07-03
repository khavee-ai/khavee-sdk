---
phase: quick-260703-slv
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - wordpress-plugin/includes/Platform/PlatformClient.php
  - wordpress-plugin/includes/ConfigSource/PlatformConfigSource.php
  - wordpress-plugin/includes/Plugin.php
  - wordpress-plugin/tests/platform-config-harness.php
  - wordpress-plugin/includes/Admin/SettingsPage.php
  - wordpress-plugin/tests/settings-page-harness.php
autonomous: true
requirements: [PLATFORM-KEY-01]
must_haves:
  truths:
    - "An admin can enter a second, separate 'Khavee Platform API Key' (format khavee_<uuid>_<64hex>) in the settings page, masked and removable exactly like the existing OpenAI key."
    - "When a platform key is set and the fetch succeeds, platform-sourced fields (voice, instructions, avatar_url, light_intensity, background) override the locally-configured WP options — platform always wins."
    - "When the platform key is absent, or the fetch fails for ANY reason, the plugin silently falls back to the existing WpOptionsConfigSource values and never fatals or breaks page rendering."
    - "The platform key never appears in AvatarRenderer public-safe output, the REST response, or any admin notice."
    - "After saving, the admin sees a connection notice ('Connected to project: X') or a graceful error reason, with no raw key and no stack trace leaked."
    - "AvatarRenderer, AvatarBlock, and SessionController require no changes — they still depend only on ConfigSourceInterface."
  artifacts:
    - path: "wordpress-plugin/includes/Platform/PlatformClient.php"
      provides: "Cached wp_remote_get to /projects/sdk/preview + pure envelope-unwrap and field-mapping"
      contains: "class PlatformClient"
    - path: "wordpress-plugin/includes/ConfigSource/PlatformConfigSource.php"
      provides: "Decorator implementing ConfigSourceInterface, overlays mapped platform fields on the wrapped source"
      contains: "class PlatformConfigSource implements ConfigSourceInterface"
    - path: "wordpress-plugin/tests/platform-config-harness.php"
      provides: "Bare-PHP tests for mapping, fallback, and secret non-leak"
      contains: "run_case"
  key_links:
    - from: "wordpress-plugin/includes/Plugin.php"
      to: "PlatformConfigSource"
      via: "composition root wraps WpOptionsConfigSource"
      pattern: "new PlatformConfigSource\\("
    - from: "wordpress-plugin/includes/ConfigSource/PlatformConfigSource.php"
      to: "PlatformClient"
      via: "get_runtime_config() calls the cached fetch + mapper"
      pattern: "PlatformClient::"
---

<objective>
Add a second "Khavee Platform API Key" to the WordPress plugin. When present, the plugin fetches the project's config from khavee-app's hosted platform (GET https://api.platform.khavee.ai/api/v1/projects/sdk/preview, header `X-API-Key`) and overlays the mapped fields (voice, instructions, avatar_url, light_intensity, background) on top of the locally-configured WP options — "platform always wins". Any failure (missing key, network error, non-200, malformed JSON) silently falls back to the existing WpOptionsConfigSource behavior.

Purpose: Let a site owner drive avatar config from the hosted Khavee dashboard instead of re-entering everything in wp-admin, without touching the OpenAI secret path or the front-end bundle.

Output: A `PlatformClient` (cached HTTP + pure mapping), a `PlatformConfigSource` decorator, the one composition-root wiring change, the masked admin key field + connection-status notice, and bare-PHP harness coverage.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@wordpress-plugin/includes/ConfigSource/ConfigSourceInterface.php
@wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php
@wordpress-plugin/includes/Admin/SettingsPage.php
@wordpress-plugin/includes/Plugin.php
@wordpress-plugin/tests/settings-page-harness.php

<interfaces>
<!-- ConfigSourceInterface (includes/ConfigSource/ConfigSourceInterface.php): -->
<!--   get_runtime_config(): array   (public-safe, NO secrets) -->
<!--   get_api_key(): string         (server-side OpenAI secret ONLY — unrelated to platform key) -->
<!--   is_configured(): bool         (OpenAI key non-empty) -->

CONFIRMED platform API contract (do NOT re-derive):
- GET https://api.platform.khavee.ai/api/v1/projects/sdk/preview
- Header: X-API-Key: <raw platform key>
- Server-side ONLY (wp_remote_get) — no CORS for browser JS.
- Body envelope: { data, meta }. data shape:
    { name, description, thumbnailUrl, backgroundType, backgroundValue, lightIntensity,
      model: { model3dUrl, ... } | null,
      personality: { ... } | null,
      voiceProfile: { openaiVoice, instructionPrompt, ... } | null }

FIELD MAPPING (map ONLY clean 1:1 fields; overlay ONLY when the platform value is present/non-empty — a null/absent platform field must NOT blank the local value):
- voiceProfile.openaiVoice     -> voice
- voiceProfile.instructionPrompt -> instructions
- model.model3dUrl             -> avatar_url
- lightIntensity               -> light_intensity
- backgroundType==="image"     -> bg_type='image', bg_image_url=backgroundValue
- backgroundType==="color"     -> bg_type='color', bg_color=backgroundValue
- (any other backgroundType)   -> leave bg_* untouched (pass through)
DO NOT map: our `model` (OpenAI realtime model id — the platform `model` object is the 3D avatar, a naming collision), camera fields, avatar scale/offset, chat show/placement, container sizing — all stay WP-admin-controlled and delegate straight through.

Existing masking pattern to mirror (SettingsPage.php): mask_api_key() -> "sk-••••••<last4>", sanitize_api_key($submitted,$existing,$remove) with preserve-on-mask / reject-bad-format / remove-checkbox logic, render_api_key_field() + render_remove_key_field().

Bare-PHP harness convention (tests/*.php): NO WordPress, NO Composer — define minimal function_exists()-guarded stubs, require the class files by direct path, run_case(name, fn) returns bool, exit(1) on any failure.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: PlatformClient + PlatformConfigSource decorator + composition-root wiring</name>
  <files>wordpress-plugin/includes/Platform/PlatformClient.php, wordpress-plugin/includes/ConfigSource/PlatformConfigSource.php, wordpress-plugin/includes/Plugin.php, wordpress-plugin/tests/platform-config-harness.php</files>
  <behavior>
    PlatformClient::map_platform_fields(array $data): array (pure, testable):
    - Test: voiceProfile.openaiVoice="verse" -> returned ['voice'=>'verse']; absent/null voiceProfile -> no 'voice' key in output.
    - Test: model.model3dUrl="https://x/a.glb" -> ['avatar_url'=>'https://x/a.glb']; model null -> no 'avatar_url' key.
    - Test: lightIntensity=2.5 -> ['light_intensity'=>2.5]; absent -> no 'light_intensity' key.
    - Test: backgroundType="image", backgroundValue="https://x/bg.png" -> ['bg_type'=>'image','bg_image_url'=>'https://x/bg.png'].
    - Test: backgroundType="color", backgroundValue="#ff0000" -> ['bg_type'=>'color','bg_color'=>'#ff0000'].
    - Test: backgroundType="gradient" (unrecognized) -> no bg_* keys emitted.
    - Test: empty/blank openaiVoice/instructionPrompt/model3dUrl are treated as absent (not overlaid).
    PlatformConfigSource::get_runtime_config():
    - Test: no platform key configured -> returns the wrapped source's config VERBATIM (mapper never called).
    - Test: platform key set AND fetch ok -> mapped fields override wrapped values; unmapped fields (model id, camera, chat_*) equal the wrapped values unchanged.
    - Test: platform key set BUT fetch fails (WP_Error / non-200 / malformed JSON) -> returns wrapped config VERBATIM, no fatal.
    - Test: get_api_key() and is_configured() delegate to the wrapped source unchanged (return the OpenAI-key-derived values, never the platform key).
    - Test: the platform-key sentinel string never appears anywhere in get_runtime_config() output.
  </behavior>
  <action>
    RED first: create wordpress-plugin/tests/platform-config-harness.php following the exact bare-PHP convention of tests/settings-page-harness.php (function_exists()-guarded stubs, run_case(), exit(1) on failure). Stub: get_option (returns staged khaveeai_settings blob incl. an optional 'platform_api_key'), get_transient/set_transient (in-memory map so caching is observable), wp_remote_get (returns a staged response OR a staged WP_Error-shaped stub), is_wp_error, wp_remote_retrieve_response_code, wp_remote_retrieve_body. Provide a tiny WP_Error-like stub class exposing get_error_message(). require ConfigSourceInterface.php, WpOptionsConfigSource.php, Platform/PlatformClient.php, ConfigSource/PlatformConfigSource.php by direct path. Write every case in the <behavior> block, plus a sentinel-non-leak case (stage platform_api_key='khavee_LEAK_SENTINEL_...' and assert it appears in NO value of get_runtime_config()). Run it, confirm RED.

    GREEN: create includes/Platform/PlatformClient.php (namespace Khavee\Plugin\Platform). Public static map_platform_fields(array $data): array implementing the mapping table in <context> exactly — overlay a key ONLY when the platform value is present and non-empty; unrecognized backgroundType emits no bg_* keys. Public static fetch_preview(string $key): array returning ['ok'=>bool, 'project_name'=>string, 'fields'=>array, 'error'=>string]: cache via a WP transient keyed on a hash of the key (e.g. 'khaveeai_platform_' . md5($key), 5-minute / 300s TTL); on cache miss call wp_remote_get('https://api.platform.khavee.ai/api/v1/projects/sdk/preview', ['headers'=>['X-API-Key'=>$key], 'timeout'=>8]); treat is_wp_error, response code !== 200, non-array/malformed JSON, or a missing `data` envelope as ok=false with a SHORT generic error reason (HTTP status or "network error" — NEVER the raw key, NEVER an exception/stack trace); on success set 'project_name' from data.name and 'fields' from map_platform_fields(data). Cache the resulting struct (both ok and error outcomes) so a broken key does not hammer the API every render.

    Create includes/ConfigSource/PlatformConfigSource.php (namespace Khavee\Plugin\ConfigSource) implementing ConfigSourceInterface, decorating a wrapped ConfigSourceInterface passed to its constructor. get_api_key() and is_configured() delegate straight through (untouched OpenAI-key behavior). get_runtime_config(): start from $this->wrapped->get_runtime_config(); read the platform key from get_option('khaveeai_settings')['platform_api_key'] (mirrors WpOptionsConfigSource reading get_option directly — do NOT add a method to the interface); if empty, return the wrapped config unchanged; otherwise call PlatformClient::fetch_preview() and, only when ok, array_merge the mapped fields OVER the wrapped config (mapped keys win). On ok=false return the wrapped config unchanged. Wrap the fetch/merge in a try/catch that falls back to the wrapped config on any Throwable — never fatal.

    Wire it: in includes/Plugin.php::boot(), change `$config_source = new WpOptionsConfigSource();` to `$config_source = new PlatformConfigSource( new WpOptionsConfigSource() );` and add the `use Khavee\Plugin\ConfigSource\PlatformConfigSource;` import. This is the ONLY wiring change — SessionController/AvatarRenderer/AvatarBlock/SettingsPage all keep receiving a ConfigSourceInterface and need no edits. Run the harness, confirm GREEN.
  </action>
  <verify>
    <automated>php wordpress-plugin/tests/platform-config-harness.php</automated>
  </verify>
  <done>platform-config-harness.php passes all cases; PlatformClient + PlatformConfigSource exist; Plugin.php wraps WpOptionsConfigSource in PlatformConfigSource; existing render-logic-harness.php and settings-page-harness.php still pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Platform key admin field (masked + removable) + post-save connection notice</name>
  <files>wordpress-plugin/includes/Admin/SettingsPage.php, wordpress-plugin/tests/settings-page-harness.php</files>
  <behavior>
    SettingsPage::mask_platform_key(string $key): string (static, pure):
    - Test: 'khavee_abcd_...wxyz' -> 'khavee_••••••wxyz' (literal prefix + last 4).
    - Test: '' -> '' (never a bare mask placeholder).
    SettingsPage::sanitize_platform_api_key($submitted, $existing, $remove): string (static or instance, mirroring sanitize_api_key):
    - Test: remove flag true -> '' (deliberate removal).
    - Test: submitted === mask_platform_key(existing) -> existing unchanged (masked placeholder preserved on unrelated save).
    - Test: a genuinely new value not starting with 'khavee_' -> returns existing (rejected, no overwrite).
    - Test: a fresh 'khavee_...'-prefixed value with surrounding whitespace -> returned trimmed.
  </behavior>
  <action>
    RED first: extend tests/settings-page-harness.php with the mask_platform_key / sanitize_platform_api_key cases in the <behavior> block, added AFTER the existing cases and BEFORE the final live exit() block (that exit block must remain the last statement). Reuse the existing stubs (__, add_settings_error, get_option, __khaveeai_build_settings_page()). Run it, confirm the new cases are RED.

    GREEN: in SettingsPage.php add — mirroring the existing OpenAI api_key field exactly:
    - A `platform_api_key` add_settings_field (label "Khavee Platform API Key") and a paired "Remove Platform Key" checkbox field (name `%s[remove_platform_key]`), registered in register_settings() in the khaveeai_main section.
    - static mask_platform_key(string $key): string -> '' for empty, else 'khavee_••••••' . substr($key,-4) (T-07B-03 discipline: never echo the raw key).
    - sanitize_platform_api_key($submitted, $existing, $remove_requested): same decision order as sanitize_api_key but the format gate checks the `khavee_` prefix instead of `sk-`; reject-bad-format keeps existing (add_settings_error), preserve-on-mask, remove-checkbox clears.
    - In sanitize_settings(): read existing platform key from $existing_option['platform_api_key'], read $input['remove_platform_key'], and set $sanitized['platform_api_key'] = $this->sanitize_platform_api_key(...). Leave the existing api_key/voice/avatar logic untouched.
    - render_platform_api_key_field() + render_remove_platform_key_field(): read the existing platform key from get_option(self::OPTION_NAME)['platform_api_key'] directly (SettingsPage stays typed to ConfigSourceInterface; the interface does not expose the platform key), and echo ONLY mask_platform_key() output in the value attribute (esc_attr). Description explains "platform always wins when set".
    - Connection-status notice in render_page(): after settings_errors(), if a platform key is configured, call \Khavee\Plugin\Platform\PlatformClient::fetch_preview($platform_key) (cached — cheap) and echo a notice-success "Connected to project: <esc_html name>" when ok, else a notice-warning "Couldn't reach Khavee Platform: <esc_html short reason>". NEVER echo the raw key or an exception/stack trace. Because the transient is keyed on the key's hash, saving a new key produces a fresh fetch and fresh feedback on the next render.
    Run the harness, confirm GREEN. Do NOT change render_api_key_field or any avatar-upload logic.
  </action>
  <verify>
    <automated>php wordpress-plugin/tests/settings-page-harness.php</automated>
  </verify>
  <done>settings-page-harness.php passes all cases (existing + new platform-key mask/sanitize); the platform key field renders masked with a remove checkbox; the connection notice appears without leaking the raw key.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| WP admin form → wp_options | Admin submits the platform key; sanitize_callback is the only real gate on a crafted options.php POST |
| PHP server → api.platform.khavee.ai | Untrusted JSON response crosses back into config used for rendering |
| Merged config → front-end mount / REST | public-safe whitelist must exclude every secret |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-QK-01 | Information Disclosure | platform_api_key in admin UI | mitigate | Value attribute is always mask_platform_key() output (last 4 only); never the raw key (mirrors T-07B-03) |
| T-QK-02 | Information Disclosure | platform key in front-end / REST | mitigate | Key is never added to get_runtime_config(); public_safe() whitelist already excludes it; harness sentinel case asserts non-leak |
| T-QK-03 | Information Disclosure | connection-status notice | mitigate | Notice prints only project name or a short generic reason — never the raw key, WP_Error internals, or a stack trace |
| T-QK-04 | Denial of Service | per-render fetch to platform API | mitigate | 5-minute WP transient (keyed on key hash) caches both success and failure; timeout=8s bounds a hung request |
| T-QK-05 | Tampering | crafted platform_api_key via options.php POST | mitigate | sanitize_platform_api_key() rejects any value not prefixed `khavee_`, preserving the existing key |
| T-QK-06 | Denial of Service | malformed/hostile platform JSON | mitigate | try/catch + ok=false on non-200/WP_Error/malformed JSON/missing `data`; silent fallback to wrapped source, never fatal |
</threat_model>

<verification>
- `php wordpress-plugin/tests/platform-config-harness.php` — mapping, fallback, delegation, secret non-leak all pass.
- `php wordpress-plugin/tests/settings-page-harness.php` — existing + new platform mask/sanitize cases pass.
- `php wordpress-plugin/tests/render-logic-harness.php` — unchanged, still passes (AvatarRenderer untouched).
- `php -l` clean on the two new PHP files and the two edited PHP files.
</verification>

<success_criteria>
- Platform key can be entered, is masked and removable, and never leaks to the front-end, REST, or notices.
- With a platform key set and fetch ok, voice/instructions/avatar_url/light_intensity/background come from the platform; unmapped fields (OpenAI model id, camera, chat, sizing) stay WP-admin-controlled.
- Any fetch failure or absent key falls back to WpOptionsConfigSource with no fatal.
- AvatarRenderer, AvatarBlock, SessionController unchanged; only Plugin.php wiring + SettingsPage UI + two new files changed.
</success_criteria>

<output>
Create `.planning/quick/260703-slv-add-khavee-platform-api-key-integration-/260703-slv-SUMMARY.md` when done
</output>
