# Phase 6: PHP Backend Core — Config/Token Strategies + REST Contract - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the WordPress plugin's PHP backend core: a `ConfigSourceInterface` + `TokenProviderInterface` strategy seam (one concrete implementation each this milestone), and a public, anonymous-accessible REST route that takes the existing JS SDK's `proxyEndpoint` request shape (`{ sessionConfig }`) and returns an ephemeral OpenAI Realtime token (`{ data: { ephemeralToken, sessionId } }`), with rate limiting, a daily mint cap, and `Cache-Control: no-store`. No shortcode, block, settings UI, or frontend bundle is built in this phase — those are Phases 7 and 8.

</domain>

<decisions>
## Implementation Decisions

### Rate Limiting & Cap Scope
- **D-01:** Per-IP rate limit: 5 token mints per IP per 10-minute window.
- **D-02:** Daily mint cap applies at BOTH levels: a per-IP cap and a sitewide cap — closes the distributed-abuse-across-many-IPs gap that a per-IP-only limit would leave open.
- **D-03:** Default sitewide daily cap: 200 mints/day.
- **D-04:** Thresholds (rate limit window/count, daily caps) are hardcoded defaults in the PHP code, overridable via a documented `wp_filter`/constant for advanced admins — NOT exposed as a settings-page field. Keeps the Phase 7 settings page at its planned 4 fields (API key, instructions, voice, avatar) per FEATURES.md's anti-bloat guidance.

### Abuse / Cap Response Behavior
- **D-05:** When throttled (per-IP or daily cap exceeded), the route returns HTTP 429 with a generic JSON error body — no internal details. The frontend bundle (built in Phase 8) shows a neutral "unavailable right now" placeholder, not the live avatar.
- **D-06:** No admin-facing visibility (dashboard, email, notice) for rate-limit/cap hits in v1 — consistent with REQUIREMENTS.md's deferral of usage/analytics dashboards (MULTI-03). Admin can check their own OpenAI usage dashboard for spend anomalies.

### Token-Route Trust Model
- **D-07:** The route does NOT trust browser-sent `voice`/`instructions` fields in the `sessionConfig` POST body. It always injects the admin's configured `instructions` and `voice` from `ConfigSourceInterface::get_runtime_config()`, regardless of what the request body contains. This is a deliberate divergence from the existing `OpenAIRealtimeProvider`/`proxyEndpoint` precedent (which trusts the client's `sessionConfig` as-is) — closes the "anonymous visitor scripts a jailbreak prompt through the public endpoint" gap. Other `sessionConfig` fields not tied to admin config (e.g. `type`, `output_modalities`, `audio.output.format`) may still come from the request body / hardcoded route defaults, since they're not security- or cost-sensitive.
- **D-08:** This phase's route contract supports ONLY the global admin config — no per-instance (shortcode/block) override fields. Phase 8 will decide how/whether `EMBED-02`'s per-instance voice/instructions overrides thread through to this route (e.g. an additional whitelisted, validated override parameter) — explicitly deferred, not designed speculatively now.

### OpenAI Mint-Failure Handling
- **D-09:** When the server-side call to OpenAI fails (bad/expired key, quota exceeded, OpenAI outage), the route returns a generic HTTP 502 with no OpenAI error text, status detail, or key-related information in the response body. Visitor sees the same neutral placeholder as the missing/invalid-key case (SET-06, built in Phase 7).
- **D-10:** Mint failures are logged to the PHP error log only (one line per failure) — no settings-page notice, no email. Consistent with D-06's "no new admin-visibility UI in v1" stance.

### Claude's Discretion
- Exact REST namespace/route path naming (e.g. `khaveeai/v1/session` vs `khaveeai/v1/token`) — not discussed, left to the planner/implementation; should be consistent with whatever naming the `Plugin.php` composition root and other routes (if any) use.
- Rate-limiting storage mechanism (WP transients keyed by IP, per PITFALLS.md research) and exact daily-cap reset boundary (rolling 24h vs midnight server time) — implementation detail, not a user-facing decision.
- Whether the per-IP and sitewide counters share one transient-based mechanism or two separate ones — implementation detail.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone planning artifacts
- `.planning/ROADMAP.md` (Phase 6 section) — phase goal, success criteria, requirement IDs
- `.planning/REQUIREMENTS.md` (ARCH-01, ARCH-02, REST-01, REST-02, REST-03, REST-04) — exact requirement wording for this phase
- `.planning/PROJECT.md` — milestone context, constraints (out-of-scope items), Key Decisions table

### Architecture & pitfalls research (this milestone)
- `.planning/research/ARCHITECTURE.md` — `ConfigSourceInterface`/`TokenProviderInterface` contracts, suggested PHP class/file list, OpenAI ephemeral-token endpoint contract (`POST /v1/realtime/client_secrets`), build order
- `.planning/research/PITFALLS.md` — anonymous-token-route abuse/caching pitfalls (rate limiting, `Cache-Control: no-store`, referer checks), React/Gutenberg bundling pitfalls (relevant to later phases, not this one)
- `.planning/research/STACK.md` — `wp_remote_post()` for the server-side OpenAI call (no Composer HTTP client), WP REST `permission_callback` patterns for anonymous routes

### Existing contract this route must satisfy (TypeScript side, NOT to be modified)
- `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts` lines 134-226 — the actual `connect()` logic that calls `proxyEndpoint`: POSTs `{ sessionConfig }` JSON, expects a response shaped `{ data: { ephemeralToken, sessionId } }` (with `tokenData.ephemeralToken`/`tokenData.value` as fallback shapes), then uses the returned token as a `Bearer` token directly against `https://api.openai.com/v1/realtime/calls` for WebRTC SDP exchange — this last step happens entirely client-side and is NOT proxied by the WP route.
- `packages/core/src/types/realtime.ts` lines 27-56 — `RealtimeConfig.proxyEndpoint` doc comment confirms the exact expected response shape; `voice` enum (`alloy | ash | ballad | coral | echo | sage | shimmer | verse | marin | cedar`) is the authoritative voice list for Phase 7's voice picker
- `.planning/codebase/INTEGRATIONS.md` — confirms `src/app/api/negotiate/route.ts` is an SDP-relay (NOT the ephemeral-token contract) and must not be used as a reference implementation for this route — already flagged as a discrepancy during milestone research

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None directly importable into PHP — this is a new PHP plugin with no prior WordPress code in the repo. The TypeScript side (`OpenAIRealtimeProvider`, `RealtimeConfig`) is the contract to satisfy, not code to reuse.

### Established Patterns
- "Backend proxy assumption" (per project CLAUDE.md): every existing provider that talks to OpenAI keeps the API key server-side and only returns derived/short-lived data to the browser. This phase's route is the PHP-side instance of that same pattern.
- Error normalization pattern (`error instanceof Error ? error : new Error(...)`) used throughout the TS codebase — not directly applicable to PHP, but the spirit (always return a normalized, safe error to the caller) carries over to D-09's "generic 502, no leaked detail" decision.

### Integration Points
- The route's response shape is consumed by `OpenAIRealtimeProvider.connect()` exactly as documented above — Phase 8's frontend bundle will configure `proxyEndpoint` to point at this route and set `useProxy: true`. No changes needed to `OpenAIRealtimeProvider` itself (it's explicitly out of scope per PROJECT.md).

</code_context>

<specifics>
## Specific Ideas

No specific UI/copy requirements were discussed — this phase has no user-facing surface (it's a backend route). The "neutral placeholder" and "admin-only notice" UI mentioned in D-05/D-09 are Phase 7/8 concerns; this phase only needs to produce the right HTTP status codes and response shapes for those later phases to build against.

</specifics>

<deferred>
## Deferred Ideas

- Per-instance (shortcode/block) voice/instructions override support in the token route's request contract — explicitly deferred to Phase 8 per D-08, not designed now.
- Admin-facing visibility into rate-limit/cap hits or OpenAI mint failures (dashboard, settings notice, email) — deferred indefinitely per D-06/D-10, matches REQUIREMENTS.md's MULTI-03 deferral of usage/analytics dashboards.
- Settings-page exposure of rate-limit/cap thresholds — deferred per D-04, available only via `wp_filter`/constant override for advanced admins.

None — discussion stayed within phase scope otherwise.

</deferred>

---

*Phase: 6-php-backend-core-config-token-strategies-rest-contract*
*Context gathered: 2026-06-21*
