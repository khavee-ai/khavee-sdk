# Phase 6: PHP Backend Core — Config/Token Strategies + REST Contract - Pattern Map

**Mapped:** 2026-06-21
**Files analyzed:** 11 (PHP) + 0 modified TS
**Analogs found:** 0 / 11 (PHP-side) — 3 TS-side **contract references** (not code analogs)

## IMPORTANT: No PHP Analogs Exist in This Repo

`wordpress-plugin/includes/` and `wordpress-plugin/src/` are confirmed empty directories (verified via `ls -la`). This is the **first PHP code ever written in this repository**. There is no prior WordPress plugin, no prior PHP class, no prior REST controller, no prior strategy-pattern PHP code to copy style/conventions from.

Consequently, this PATTERNS.md does **not** point the planner at "copy this file's code" the way a normal pattern map would. Instead, for each new PHP file it identifies:
1. **The architectural contract** the file must satisfy (from `ARCHITECTURE.md`'s suggested class list and method signatures — these are normative, not optional, since they were decided in CONTEXT.md's `<decisions>`)
2. **The TS-side wire-contract reference** the REST route specifically must match byte-for-byte in response shape (this is the one place where "pattern matching" is load-bearing — get the JSON shape wrong and the existing, unmodifiable `OpenAIRealtimeProvider.ts` breaks)
3. **The cross-language spirit-carryover** from established TS conventions (error normalization, "secret never crosses the boundary") that the planner should restate as PHP idioms, not copy as PHP syntax

Treat every "Analog" cell below as **"contract source"**, not **"code to literally copy"**.

## File Classification

| New File | Role | Data Flow | Contract Source | Match Quality |
|----------|------|-----------|------------------|----------------|
| `includes/ConfigSource/ConfigSourceInterface.php` | interface (config/strategy) | request-response | `ARCHITECTURE.md` Pattern 1 | no-analog (spec only) |
| `includes/ConfigSource/WpOptionsConfigSource.php` | service (CRUD over wp_options) | CRUD | `ARCHITECTURE.md` Pattern 1 + STACK.md Settings API notes | no-analog (spec only) |
| `includes/TokenProvider/TokenProviderInterface.php` | interface (strategy) | request-response | `ARCHITECTURE.md` Pattern 1 | no-analog (spec only) |
| `includes/TokenProvider/OpenAiDirectTokenProvider.php` | service (external API client) | request-response | `STACK.md` `wp_remote_post()` guidance; TS `STTClient.ts`/`ChatClient.ts` "proxy client" *shape* (not code) | partial (cross-language pattern only) |
| `includes/Rest/SessionController.php` | controller (WP REST) | request-response | `ARCHITECTURE.md` Pattern 3 (exact code given); `OpenAIRealtimeProvider.ts:134-226` (consumer contract); `realtime.ts:27-56` (response shape doc) | exact (wire contract only — no PHP code analog) |
| `includes/RateLimit/RateLimiter.php` (or equivalent, naming at Claude's discretion) | utility (abuse mitigation) | CRUD (transient counters) | `PITFALLS.md` Pitfall 1/3; `ARCHITECTURE.md` Scaling Considerations | no-analog (spec only) |
| `includes/Plugin.php` | provider (composition root) | event-driven (hook registration) | `ARCHITECTURE.md` Suggested Build Order step 4 | no-analog (spec only) |
| `khaveeai.php` | config (plugin bootstrap) | N/A | `ARCHITECTURE.md` Suggested Build Order step 11; STACK.md plugin header conventions | no-analog (spec only) |
| `includes/Rest/SessionController.php` permission_callback | middleware (auth/abuse-gate) | request-response | `PITFALLS.md` Pitfall 2; `STACK.md` "What NOT to Use" → nonces row | no-analog (spec only) |

Note: `Render/`, `Shortcode/`, `Block/`, `Admin/`, `Assets/` classes from `ARCHITECTURE.md`'s full file list are **out of scope for Phase 6** per CONTEXT.md's `<domain>` boundary ("No shortcode, block, settings UI, or frontend bundle is built in this phase — those are Phases 7 and 8"). Excluded from classification above; do not plan them into this phase.

## Pattern Assignments

### `includes/ConfigSource/ConfigSourceInterface.php` (interface, request-response)

**Contract source:** `ARCHITECTURE.md` lines 126-132 (Pattern 1)

No PHP analog exists. Use the exact interface shape from research, verbatim:

```php
interface ConfigSourceInterface {
    /** Public-safe display/runtime config — never includes the API key. */
    public function get_runtime_config(): array; // ['instructions' => ..., 'voice' => ..., 'avatar_url' => ..., 'model' => ...]

    /** Server-side-only secret, never serialized into a REST response or the JS bundle. */
    public function get_api_key(): string;
}
```

**Cross-cutting invariant to enforce (from CONTEXT.md D-07 + ARCHITECTURE.md Key Data Flows #2):** `get_api_key()` must never be called from anywhere except `SessionController`/`TokenProviderInterface` wiring — never logged, never included in any array returned to a REST response.

---

### `includes/ConfigSource/WpOptionsConfigSource.php` (service, CRUD)

**Contract source:** `ARCHITECTURE.md` line 69, line 282 (Integration Points: "Admin settings page ↔ ConfigSourceInterface")

No PHP analog. Reads `get_option('khaveeai_settings')`, implements `ConfigSourceInterface`. Per CONTEXT.md D-07, this is the source of truth `SessionController` must call to inject `instructions`/`voice` — never trust the client's `sessionConfig` body for those two fields.

**Validation approach (per STACK.md):** No schema library — sanitize with WordPress core functions (`sanitize_text_field()`, `sanitize_textarea_field()`) at the point options are *written* (Phase 7's SettingsPage, out of scope here); this phase's `get_runtime_config()` only *reads* already-sanitized data, so no additional validation needed on read.

---

### `includes/TokenProvider/TokenProviderInterface.php` (interface, request-response)

**Contract source:** `ARCHITECTURE.md` lines 134-141 (Pattern 1)

```php
interface TokenProviderInterface {
    /**
     * @param array $session_config Shape matching OpenAIRealtimeProvider's `sessionConfig` (model, instructions, voice, tools, audio).
     * @param string $api_key Resolved by ConfigSourceInterface::get_api_key(), passed in — TokenProvider never reads wp_options itself.
     * @return array{ephemeralToken: string, sessionId: ?string, expiresAt: ?int}
     */
    public function mint_session(array $session_config, string $api_key): array;
}
```

Note the deliberate DI seam: `TokenProviderInterface` takes the API key as a parameter rather than resolving it itself — this is the one architectural rule from the research that has zero PHP precedent but is non-negotiable for the "swap to Platform mode later" goal stated in CONTEXT.md.

---

### `includes/TokenProvider/OpenAiDirectTokenProvider.php` (service, request-response / external API client)

**Contract source (architecture):** `ARCHITECTURE.md` Integration Points → "OpenAI Realtime API (ephemeral token mint)" row; Suggested Build Order step 2.
**Contract source (HTTP mechanics):** `STACK.md` "What NOT to Use" → `wp_remote_post()` row (explicit timeout requirement, default WP timeout is only 3s).
**Cross-language pattern (style only, NOT code):** `packages/providers/openai-stt-tts/src/STTClient.ts` (full file read above) — even though this is TS not PHP, its *shape* is the closest thing to an analog in spirit: a small, single-purpose class with one public async method that POSTs to an external endpoint, checks `res.ok`/status, and throws a plain `Error` with the status code embedded in the message on failure.

**What to port from `STTClient.ts`'s spirit, in PHP terms (no direct code copy possible — different language/HTTP client):**
- `STTClient.transcribe()` throws `Error(\`STT proxy error: ${res.status} ${body}\`)` on non-2xx (`STTClient.ts:61`) → PHP equivalent: `OpenAiDirectTokenProvider::mint_session()` should detect `is_wp_error($response)` OR a non-2xx `wp_remote_retrieve_response_code($response)`, and either throw a PHP exception or return a sentinel the controller maps to **HTTP 502 with no leaked detail** (per CONTEXT.md D-09 — this diverges from the TS pattern, which DOES leak status/body text; PHP must NOT do that here, since this is a public-facing route, not an internal SDK throw boundary).
- Required explicit timeout per STACK.md: `wp_remote_post($url, ['timeout' => 10, ...])` — WP's 3s default is called out as insufficient.
- Response reshaping: OpenAI's actual response top-level field is `value` (per ARCHITECTURE.md line 221: `{ value: "ek_...", session: {...} }`) — `mint_session()` must read `$body['value']` (not `ephemeralToken`) from OpenAI's raw response and remap it to the `ephemeralToken` key in its own return array, per the `TokenProviderInterface` contract above.

**Error-logging requirement (CONTEXT.md D-10):** On mint failure, log one line to the PHP error log (`error_log()`) — no admin notice, no email.

---

### `includes/Rest/SessionController.php` (controller, request-response)

**Contract source (PHP-shape):** `ARCHITECTURE.md` lines 179-195 (Pattern 3 — exact starter code given by research)
**Contract source (wire shape — load-bearing, exact match required):** `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts` lines 134-226 (read in full above) + `packages/core/src/types/realtime.ts` lines 27-56 (read in full above)

This is the one file in the phase where getting the *response JSON shape* exactly right matters more than any PHP style consideration, because the consumer (`OpenAIRealtimeProvider.connect()`) is explicitly out of scope and unmodifiable.

**Exact consumer-side parsing logic this route must satisfy** (`OpenAIRealtimeProvider.ts:195-219`):
```typescript
const tokenRes = await fetch(proxyEndpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sessionConfig }),
});
if (!tokenRes.ok) {
  const errText = await tokenRes.text();
  throw new Error(`Failed to fetch ephemeral token: ${tokenRes.status} ${errText}`);
}
const tokenData = (await tokenRes.json()) as ProxyTokenResponse;
bearerToken =
  tokenData.data?.ephemeralToken ??
  tokenData.data?.value ??
  tokenData.ephemeralToken ??
  tokenData.value ??
  "";
if (!bearerToken) {
  throw new Error("Proxy token response did not include a token value");
}
this.sessionId = tokenData.data?.sessionId ?? tokenData.sessionId ?? this.sessionId;
```

`ProxyTokenResponse` type (`OpenAIRealtimeProvider.ts:17-26`):
```typescript
type ProxyTokenResponse = {
  data?: { ephemeralToken?: string; value?: string; sessionId?: string };
  ephemeralToken?: string;
  value?: string;
  sessionId?: string;
};
```

**Implication for `SessionController::create_session()`'s success response:** Must be `{ "data": { "ephemeralToken": "ek_...", "sessionId": "..." } }` at minimum — the `data.ephemeralToken` path is checked first by the client, so that's the canonical field to populate (the flatter fallback fields exist for other backends, not relevant to this PHP route).

**`RealtimeConfig.proxyEndpoint` doc comment** (`realtime.ts:50-55`), confirming the same shape from the type-author's intent:
```typescript
/**
 * Full URL of the backend token endpoint.
 * e.g. `https://api.example.com/api/v1/projects/{projectId}/chat/token`
 * The endpoint must return `{ data: { ephemeralToken: string, sessionId: string } }`.
 */
proxyEndpoint?: string;
```

**Starter PHP shape from research** (`ARCHITECTURE.md:179-195`, to be extended with rate-limiting/cap/trust-model logic from CONTEXT.md decisions):
```php
public function create_session( WP_REST_Request $request ): WP_REST_Response {
    $api_key = $this->config_source->get_api_key();
    if ( empty( $api_key ) ) {
        return new WP_REST_Response( [ 'error' => 'khaveeai_not_configured' ], 503 );
    }
    $session_config = $request->get_param( 'sessionConfig' ) ?? [];
    $result = $this->token_provider->mint_session( $session_config, $api_key );
    // Shape MUST match ProxyTokenResponse parsed in OpenAIRealtimeProvider.ts connect()
    return new WP_REST_Response( [
        'data' => [
            'ephemeralToken' => $result['ephemeralToken'],
            'sessionId'      => $result['sessionId'] ?? null,
        ],
    ], 200 );
}
```

**Required deviations from the research starter, per CONTEXT.md decisions (planner must add these, they are not in the snippet above):**
- **D-07 (trust model):** Before calling `mint_session()`, strip/override `instructions` and `voice` in `$session_config` with `$this->config_source->get_runtime_config()`'s values, regardless of what `$request->get_param('sessionConfig')` contains. Other fields (`type`, `output_modalities`, `audio.output.format`) may pass through from the request body or route defaults.
- **D-05 (rate-limit/cap exceeded):** Return HTTP 429, generic JSON body, no internal detail — before even resolving the API key, ideally in `permission_callback` or as the first check in `create_session()`.
- **D-09 (OpenAI mint failure):** Catch `OpenAiDirectTokenProvider` failures and return HTTP 502, generic body, no leaked OpenAI error text/status/key info — diverges from the `STTClient.ts`/`ChatClient.ts` pattern of embedding status+body in the thrown message (that pattern is for internal SDK consumers, not a public route).
- **Pitfall 3 / D-cache:** Response must include `Cache-Control: no-store` header; route registered as `POST` only.
- **Pitfall 2 / `permission_callback`:** Must be `'__return_true'` plus the rate-limit/cap checks — explicitly NOT `wp_verify_nonce()`/`is_user_logged_in()` gating (see STACK.md "What NOT to Use" table, nonces row).

---

### `includes/RateLimit/RateLimiter.php` (utility, CRUD over WP transients)

**Contract source:** `ARCHITECTURE.md` Scaling Considerations table (transient-based per-IP counting); `PITFALLS.md` Pitfall 1 ("How to avoid" bullets) and Pitfall 3.

No PHP analog exists anywhere in the repo (no other rate-limiting code in the TS side either — the TS SDK has no concept of a public, abusable endpoint since every existing provider assumes a trusted caller). This is pure greenfield design against the research spec. Key requirements collected from CONTEXT.md decisions:

- **D-01:** Per-IP: 5 mints / IP / 10-minute window.
- **D-02 + D-03:** Sitewide daily cap of 200 mints/day, tracked independently of the per-IP counter (two-level check).
- **D-04:** Thresholds as PHP constants/defaults, overridable via a `wp_filter` — NOT settings-page fields.

Suggested implementation shape (transient-keyed counters, per `PITFALLS.md` "How to avoid" guidance under Pitfall 1):
```php
// Per-IP: set_transient("khaveeai_rl_{$ip}", $count, 10 * MINUTE_IN_SECONDS)
// Sitewide daily: set_transient('khaveeai_daily_mints', $count, DAY_IN_SECONDS)
// Both incremented atomically inside create_session()'s gate, before calling mint_session().
```

---

### `includes/Plugin.php` (composition root, event-driven)

**Contract source:** `ARCHITECTURE.md` lines 63-65 ("Plugin.php as composition root" rationale), Suggested Build Order step 4.

No PHP analog. This is the one place that does `new WpOptionsConfigSource()` and `new OpenAiDirectTokenProvider()` and injects them into `SessionController` via constructor args, then calls `register_rest_route` via a `rest_api_init` hook callback. No DI container — per STACK.md, this is intentionally the "smallest unit of DI" the milestone needs.

---

### `khaveeai.php` (plugin bootstrap, config)

**Contract source:** `STACK.md` "Native WordPress plugin file structure" row; `ARCHITECTURE.md` Suggested Build Order step 11.

No PHP analog. Minimal: plugin header docblock (`Plugin Name`, `Version`, `Requires PHP`), `require __DIR__ . '/vendor/autoload.php'` for Composer PSR-4 autoload, and final hook registration delegating to `Plugin.php`. Per STACK.md, target `Requires PHP: 8.0+` unless wordpress.org distribution is confirmed (not decided in this phase's CONTEXT.md — leave as `8.0+` per STACK.md's self-hosted default, flag for Claude's discretion if ambiguous at implementation time).

---

## Shared Patterns

### Error Normalization — Spirit Carryover from TS, NOT Direct Code Reuse

**TS source pattern:** `error instanceof Error ? error : new Error(String(error))`, used throughout `packages/providers/openai-stt-tts/src/*.ts` (per CLAUDE.md's documented Error Handling conventions) — always normalize unknown values to a known error type before surfacing.

**PHP equivalent to apply across `OpenAiDirectTokenProvider.php` and `SessionController.php`:** Never let a raw `WP_Error`, `wp_remote_post()` failure, or unexpected array shape propagate as an uncaught exception or a response containing internal detail. Always:
1. Check `is_wp_error($response)` immediately after every `wp_remote_post()` call.
2. Normalize to one of exactly two outward-facing shapes: `{ error: 'khaveeai_not_configured' }` (503, missing key) or a generic mint-failure body (502, per D-09) — never pass through `$response->get_error_message()` or OpenAI's raw error JSON to the REST response.
3. Log the *real* detail server-side only (`error_log()`), per D-10.

This is a stronger, more restrictive version of the TS pattern (TS's `STTClient`/`ChatClient` DO leak status+body into thrown messages — but those are SDK-internal throws caught by the SDK's own `onError` callback, consumed by a trusted app developer, not a public anonymous HTTP response). Do not copy the TS leak-status-in-message behavior into this PHP route.

### "Backend Proxy Assumption" — The One Universal Constraint

**Source:** Project CLAUDE.md, Architectural Constraints → "Backend proxy assumption" bullet; restated for this phase in CONTEXT.md `<code_context>`.

**Applies to:** `ConfigSourceInterface::get_api_key()`, `TokenProviderInterface::mint_session()`, `SessionController::create_session()` — the real OpenAI key must never appear in any REST response, error message, or log line visible to the browser. Every existing TS provider (`OpenAISTTTTSProvider`, `OpenAIRealtimeProvider` in proxy mode) follows this same invariant server-side; this PHP route is simply this constraint's first PHP-side instance.

### Public, Anonymous-Route Permission Model (No Direct Analog — Architectural Decision, Not Code Pattern)

**Source:** `STACK.md` "What NOT to Use" table (nonces row); `PITFALLS.md` Pitfall 2.

**Applies to:** `SessionController`'s route registration only. `permission_callback => '__return_true'`, with all real abuse mitigation living in the rate-limiter check inside the callback chain, not in WP's nonce system. Document this explicitly in code comments as "intentionally public, abuse-mitigated via rate limiting, not authenticated" — per Pitfall 2's explicit recommendation to avoid looking like an oversight.

## No Analog Found

All 9 new PHP files have no analog in the codebase — this is expected and stated upfront. Listed here for completeness per the output format:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `includes/ConfigSource/ConfigSourceInterface.php` | interface | request-response | First PHP file in repo; no prior strategy interfaces in any language map 1:1 to PHP `interface` syntax |
| `includes/ConfigSource/WpOptionsConfigSource.php` | service | CRUD | No prior `wp_options`-backed class anywhere in repo |
| `includes/TokenProvider/TokenProviderInterface.php` | interface | request-response | Same as above |
| `includes/TokenProvider/OpenAiDirectTokenProvider.php` | service | request-response | Closest "spirit" analog is TS's `STTClient.ts`, but cross-language — no PHP HTTP-client class exists |
| `includes/Rest/SessionController.php` | controller | request-response | No prior WP_REST_Controller anywhere; wire-contract match to TS is exact, but PHP code pattern is novel |
| `includes/RateLimit/RateLimiter.php` | utility | CRUD (transients) | No rate-limiting code exists anywhere in this codebase, TS or PHP |
| `includes/Plugin.php` | provider/composition-root | event-driven | No composition-root file exists in any language in this repo (TS packages use no DI container either) |
| `khaveeai.php` | config/bootstrap | N/A | First plugin bootstrap file ever written in this repo |

## Metadata

**Analog search scope:** Entire repo (`wordpress-plugin/` confirmed empty via `ls -la`; searched for any `.php` file repo-wide — none exist outside this phase's planned files). TS-side search scope: `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts`, `packages/providers/openai-stt-tts/src/STTClient.ts`, `packages/core/src/types/realtime.ts`, `src/app/api/negotiate/route.ts`.
**Files scanned:** 5 TS files (read in full or targeted ranges), 0 PHP files (none exist), 4 research/context docs.
**Pattern extraction date:** 2026-06-21
