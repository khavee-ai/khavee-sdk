# Phase 6: PHP Backend Core — Config/Token Strategies + REST Contract - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-21
**Phase:** 6-php-backend-core-config-token-strategies-rest-contract
**Areas discussed:** Rate-limit thresholds & cap scope, Abuse/cap response behavior, Token-route input contract, OpenAI mint-failure error handling

---

## Rate-limit thresholds & cap scope

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| Per-IP rate limit | 5 per IP per 10 min | Generous enough for a real visitor retrying a dropped connection, tight enough to block scripted abuse | ✓ |
| Per-IP rate limit | 10 per IP per hour | Looser window — fewer false-positive blocks, slower to catch abuse | |
| Daily cap scope | Both | Per-IP burst limit AND a sitewide daily cap | ✓ |
| Daily cap scope | Sitewide only | Simpler, no per-IP throttling | |
| Daily cap scope | Per-IP only | No sitewide ceiling | |
| Daily cap value | 200/day | Reasonable default for small-to-medium site | ✓ |
| Daily cap value | 1000/day | Better for higher-traffic sites | |
| Configurability | Hardcoded + filter override | Keeps settings page at 4 fields | ✓ |
| Configurability | Settings field | More flexible, adds scope | |

**User's choice:** 5/IP/10min; both per-IP and sitewide daily caps; 200/day default; hardcoded with filter override.
**Notes:** None — all recommended options accepted.

---

## Abuse/cap response behavior

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| Visitor-facing response | HTTP 429 + neutral placeholder | Generic JSON error, widget shows neutral placeholder | ✓ |
| Visitor-facing response | HTTP 429 + retry-after message | Widget tells visitor it's transient | |
| Admin visibility | No visibility in v1 | Matches MULTI-03 deferral of analytics | ✓ |
| Admin visibility | Log to PHP error log | One-line entry when sitewide cap hit | |

**User's choice:** Neutral placeholder, no admin visibility in v1.
**Notes:** None.

---

## Token-route input contract

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| Trust model | Server overrides voice+instructions | Route ignores client-sent voice/instructions, always injects ConfigSourceInterface values | ✓ |
| Trust model | Trust client sessionConfig as-is | Matches existing proxyEndpoint precedent exactly | |
| Override scope | Global config only this phase | Phase 8 decides per-instance override design | ✓ |
| Override scope | Design for overrides now | Add whitelisted override fields speculatively | |

**User's choice:** Server-side override of voice/instructions; global-config-only contract this phase.
**Notes:** Deliberate divergence from the existing `OpenAIRealtimeProvider`/`proxyEndpoint` precedent (which trusts client sessionConfig) — closes a low-severity but real abuse vector (anonymous visitor scripting arbitrary instructions through the public endpoint).

---

## OpenAI mint-failure error handling

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| Visitor-facing error | Generic 502 + neutral placeholder | No OpenAI error text or key details leaked | ✓ |
| Visitor-facing error | 502 + categorized error code | Short internal code, no raw OpenAI text | |
| Admin alert | Log to PHP error log only | One-line entry per failure | ✓ |
| Admin alert | Settings-page notice | Admin-only notice on most recent failure | |

**User's choice:** Generic 502, neutral placeholder, PHP error log only.
**Notes:** Consistent with the "no new admin-visibility UI in v1" stance from the previous area.

---

## Claude's Discretion

- Exact REST namespace/route path naming (e.g. `khaveeai/v1/session` vs `khaveeai/v1/token`)
- Rate-limiting storage mechanism (WP transients keyed by IP) and exact daily-cap reset boundary (rolling 24h vs midnight server time)
- Whether per-IP and sitewide counters share one transient-based mechanism or two separate ones

## Deferred Ideas

- Per-instance (shortcode/block) voice/instructions override support in the token route's contract — deferred to Phase 8 (D-08)
- Admin-facing visibility into rate-limit/cap hits or mint failures (dashboard, notice, email) — deferred indefinitely, matches REQUIREMENTS.md MULTI-03
- Settings-page exposure of rate-limit/cap thresholds — deferred, filter/constant override only
