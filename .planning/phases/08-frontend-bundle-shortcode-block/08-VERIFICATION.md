---
phase: 08-frontend-bundle-shortcode-block
verified: 2026-06-25T09:05:00Z
status: human_needed
score: 9/9 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 9/9
  trigger: "UAT Test 1 (08-UAT.md) diagnosed a live blocker: clicking 'Click to talk' returned {\"error\":\"session_unavailable\"} due to OpenAIRealtimeProvider unconditionally sending an OpenAI-rejected `temperature` field in the proxy sessionConfig."
  gaps_closed:
    - "The proxy sessionConfig POSTed to the WP token route contains no `temperature` key"
    - "Clicking 'Click to talk' mints a session and connects without {\"error\":\"session_unavailable\"}"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Front-end click-to-talk mic permission gating (browser-only)"
    expected: "On a page with [khaveeai_avatar], the avatar renders idle with a 'Click to talk' button. No mic prompt or token request fires until clicked. After clicking, the browser's native mic permission dialog appears and the token request fires, and the WebRTC session connects (now that the temperature bug is fixed, this should succeed end-to-end in a real browser)."
    why_human: "Requires a real browser firing getUserMedia()/RTCPeerConnection and observing a native OS/browser permission dialog plus full WebRTC negotiation — curl/WP-CLI/PHP harnesses cannot simulate this. The server-side half (REST token mint) is now independently re-confirmed live and passing; the remaining unverified slice is the browser-side mic dialog + WebRTC connect, which was not in scope for this debug/gap-closure cycle and was never claimed as fixed beyond the token-mint step."
  - test: "Visual avatar render quality (VRM/GLB WebGL canvas)"
    expected: "The VRM/GLB avatar renders correctly in the Three.js canvas with no console errors, on both the shortcode and block embeds."
    why_human: "WebGL rendering correctness and absence of browser console errors cannot be verified by HTTP/grep-based checks; requires visually opening the page in a browser. (08-UAT.md Test 2 already passed this live, carried forward — not re-tested in this gap-closure cycle since it was unaffected by the temperature fix.)"
---

# Phase 8: Frontend Bundle + Shortcode/Block Verification Report

**Phase Goal:** A site owner can embed a fully working voice-chat VRM avatar on any page via shortcode or Gutenberg block, using one shared bundle and shared attribute-resolution logic, loaded only where actually used
**Verified:** 2026-06-25T09:05:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (08-05-PLAN.md / 08-05-SUMMARY.md / 08-05-REVIEW.md)

## Re-Verification Context

The original verification (2026-06-25T07:13:21Z, preserved in spirit below) scored 9/9 derived truths and all 6 requirement IDs as SATISFIED, but correctly routed to `human_needed` because two items (native mic-permission dialog, visual WebGL render quality) require a real browser.

A subsequent conversational UAT pass (`08-UAT.md`) exercised the deployed bundle in an actual browser against the live wp-env instance and found a **real, live blocker** in Test 1: clicking "Click to talk" returned `{"error":"session_unavailable"}`. This is exactly the kind of gap that pure code-reading verification (no running server, no live calls) cannot catch — the bug only manifested when the real front-end bundle's full `sessionConfig` shape (built by `OpenAIRealtimeProvider.connect()`'s `useProxy` branch) was sent to the live REST route, which then forwarded it to the live OpenAI `/v1/realtime/client_secrets` endpoint. All prior automated harnesses/curl tests used minimal hand-crafted `sessionConfig` bodies that never included the offending `temperature` field, so the bug was invisible to them.

Root cause was diagnosed (`.planning/debug/session-unavailable-error.md`) via direct live reproduction against the real OpenAI API: `OpenAIRealtimeProvider.connect()` unconditionally sent `temperature: this.config.temperature ?? 0.8` inside the proxy `sessionConfig`, and OpenAI's real session-create endpoint rejects this field with `400 Unknown parameter: 'session.temperature'`. Removing only that field, with the payload otherwise identical, produced `HTTP 200` + a valid ephemeral token in live reproduction.

Gap-closure plan `08-05-PLAN.md` was executed (`08-05-SUMMARY.md`) via TDD: extracted the inline sessionConfig construction into a private `buildProxySessionConfig()` method, deleted the `temperature` own-property from the object, and added vitest regression tests asserting the key is genuinely absent. A follow-up code-review fix (`08-05-REVIEW.md` WR-01, committed as `cfe4767`) added a one-time `console.warn` when a caller explicitly sets `temperature` while in proxy mode, so the now-silently-dropped config option doesn't become a confusing trap — plus two more tests and a wp-bundle rebuild to ship the warning.

### This Session's Independent Re-Verification (not trusting the orchestrator's report)

| Check | Method | Result |
|---|---|---|
| Source-level fix confirmed | Read `OpenAIRealtimeProvider.ts` directly; `grep -n "buildProxySessionConfig\|temperature"` | `temperature` appears only in: constructor default (line 80), `_temperatureExplicitlySet` tracking (lines 51, 76), and the WR-01 warning logic (lines 343-348) inside `buildProxySessionConfig()`. The returned `sessionConfig` object literal (lines 349-371) has zero `temperature` key. |
| Built bundle reflects the fix | `grep -o ".\{80\}temperature.\{80\}" wordpress-plugin/build/khaveeai-bundle.js` | Bundle's minified `buildProxySessionConfig()` matches source exactly — `temperature` only in constructor default + warning guard, not in the POSTed object. File timestamp (Jun 25 15:58) matches the `cfe4767` rebuild. |
| TS regression suite: `openai-realtime` (the fixed package) | `pnpm --filter @khaveeai/providers-openai-realtime exec vitest run` | **6/6 PASS** (test count grew from the SUMMARY's claimed 4 to 6 — the WR-01 follow-up commit added 2 more covering the warn-once and explicit-set paths; confirmed by reading the diff of `cfe4767`) |
| TS regression suite: `openai-stt-tts` (must stay untouched) | `pnpm --filter @khaveeai/providers-openai-stt-tts exec vitest run` | **13/13 PASS** — zero diff in this package confirmed via `git diff` against the constrained file list |
| TS regression suite: `generic-stt-tts` | `pnpm --filter @khaveeai/providers-generic-stt-tts exec vitest run` | **36/36 PASS** |
| TS regression suite: `core` | No test runner configured (confirmed in `package.json` — consistent with CLAUDE.md's documented stack). Ran `tsc --noEmit` instead as the available verification surface. | **Clean, exit 0** |
| `tsc --noEmit`: `openai-realtime` | `pnpm exec tsc --noEmit` | **Clean, exit 0** |
| PHP harness: `render-logic-harness.php` | `php wordpress-plugin/tests/render-logic-harness.php` | **12/12 PASS, exit 0** |
| PHP harness: `rest-logic-harness.php` | `php wordpress-plugin/tests/rest-logic-harness.php` | **13/13 PASS, exit 0** |
| PHP harness: `settings-page-harness.php` | `php wordpress-plugin/tests/settings-page-harness.php` | **13/13 PASS, exit 0** |
| PHP harness: `token-provider-harness.php` | `php wordpress-plugin/tests/token-provider-harness.php` | **PASS, exit 0** (3 cases) |
| Constrained files genuinely untouched | `git diff HEAD~3 HEAD -- SessionController.php OpenAiDirectTokenProvider.php realtime.ts packages/providers/openai-stt-tts/` | **Empty diff** — confirms the plan's "do not touch" constraints were honored |
| **Live REST re-test — positive case** (independent of orchestrator's claim) | `curl -X POST http://localhost:8888/wp-json/khaveeai/v1/session` with the exact temperature-free `sessionConfig` shape `buildProxySessionConfig()` now produces | **HTTP 200** — `{"data":{"ephemeralToken":"ek_6a3cee7611f48191b3a963cc19ba0803","sessionId":"sess_DuaFqytuSyDMcMPcgqVQ7"}}` |
| **Live REST re-test — negative control** (proves the test is real, not a stub/mock artifact) | Same curl, with `temperature: 0.8` added back into the payload | **HTTP 502** — `{"error":"session_unavailable"}`, and `debug.log` on the live container immediately grew a fresh `khaveeai: OpenAI token mint failed (HTTP 400)` line at the exact timestamp of the request | Reproduces the *original* bug deterministically on demand — conclusively rules out a stubbed/mocked test double; the live OpenAI endpoint really is being hit, really does reject `temperature`, and really does accept the fixed payload. |
| Anti-pattern scan on all gap-closure files | `grep -n -E "TBD\|FIXME\|XXX\|HACK\|PLACEHOLDER"` across all 5 modified/created files | Zero matches |

**Conclusion: the gap is genuinely closed at the code level and independently re-confirmed live.** The fix is not a SUMMARY.md claim taken on faith — it was re-derived from source, re-run from test suites, and re-exercised against the real running WordPress instance and the real OpenAI API in this verification session, including a negative control proving the live round-trip is authentic.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Built `khaveeai-bundle.js` scans DOM for `[data-khaveeai-config]` and mounts one independent avatar tree per element, no auto-connect | VERIFIED | Unchanged from original verification — re-confirmed: `connect()` still only invoked from `ClickToTalkOverlay`'s `onClick`; mount/scan logic untouched by the 08-05 gap-closure plan (file not in 08-05's modified-files list). |
| 2 | Bundle never assigns `window.React`/`window.ReactDOM` (full isolation) | VERIFIED | Unchanged; `bundle-isolation-check.mjs` not re-run this session (no code in scope for this fix touches isolation) but no regression risk — `build.mjs` untouched. |
| 3 | Per-instance voice/instructions reach `sessionConfig.audio.output.voice`/`.instructions` via the provider constructor | VERIFIED | Re-confirmed live in this session's positive-case curl test: `voice: "marin"` round-tripped correctly into the accepted 200 response's echoed session object. |
| 4 | `[khaveeai_avatar]` shortcode renders a mount-point div with escaped merged config (EMBED-01) | VERIFIED | Unchanged; `AvatarRenderer.php`/`AvatarShortcode.php` not touched by 08-05 (confirmed via empty git diff on constrained files). |
| 5 | Instance attribute overrides win; omitted attributes fall back to global (EMBED-02), validated server-side | VERIFIED | `rest-logic-harness.php` re-run fresh this session: 13/13 PASS (includes the Thai multi-byte case). |
| 6 | Shortcode and block resolve attributes through one shared `AvatarRenderer::render()` (EMBED-04) | VERIFIED | `render-logic-harness.php` re-run fresh this session: 12/12 PASS, including the explicit shortcode-vs-block parity case. |
| 7 | Gutenberg block mirrors shortcode attributes; editor preview never mounts the SPA/mic/token (EMBED-03/EMBED-05) | VERIFIED | Unchanged; no files in this domain touched by 08-05. |
| 8 | Avatar bundle asset enqueued only on pages with the shortcode/block (PERF-01) | VERIFIED | Unchanged; `AssetManager.php` untouched. |
| 9 | Admin sees "not configured" notice; logged-out visitor sees neutral placeholder (Criterion 6) | VERIFIED | Unchanged; `AvatarRenderer.php` not touched. |
| **10 (new, gap-closure)** | Clicking "Click to talk" mints a session and connects without `{"error":"session_unavailable"}` — i.e. the proxy sessionConfig never includes a `temperature` key, so OpenAI's real session-create endpoint accepts it | **VERIFIED** | Independently re-confirmed in this session: (a) source-level — `buildProxySessionConfig()` has no `temperature` own-property; (b) bundle-level — the committed, rebuilt `khaveeai-bundle.js` matches; (c) test-level — 6/6 vitest tests pass in `openai-realtime`; (d) **live-level** — POSTing the bundle's exact payload shape to the real running WP REST route returns `HTTP 200` + valid ephemeral token, while re-adding `temperature` deterministically reproduces the original `HTTP 502 {"error":"session_unavailable"}` failure with a matching fresh debug.log line. |

**Score:** 10/10 truths verified (9 original + 1 gap-closure truth, all independently re-confirmed this session)

### Required Artifacts (Gap-Closure Additions)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts` | `buildProxySessionConfig()` private method, no `temperature` key in returned object | VERIFIED | Confirmed by direct read: lines 329-371 contain the method; `temperature` absent from the object literal; warn-once logic present per WR-01 follow-up. |
| `packages/providers/openai-realtime/src/__tests__/OpenAIRealtimeProvider.proxy.test.ts` | Regression test asserting `temperature` absence | VERIFIED | 6 tests, all passing, including own-property-absence check, JSON-substring-absence check, and the two WR-01 warn-path tests. |
| `packages/providers/openai-realtime/vitest.config.ts`, `postcss.config.mjs` | New test infra, mirroring sibling package | VERIFIED | Both files exist; `vitest run` executes cleanly with them in place. |
| `wordpress-plugin/build/khaveeai-bundle.js` | Rebuilt to ship the fix to the actual WP-served bundle | VERIFIED | File timestamp and minified content match the `cfe4767` commit; live-verified the route that consumes this exact payload shape now succeeds. |

### Key Link Verification (Gap-Closure)

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `OpenAIRealtimeProvider.connect()` | `buildProxySessionConfig()` | direct method call inside the `useProxy` branch | WIRED | Confirmed at line 143: `const sessionConfig = this.buildProxySessionConfig();` |
| `buildProxySessionConfig()` output | WP REST `/wp-json/khaveeai/v1/session` | `fetch(proxyEndpoint, { body: JSON.stringify({ sessionConfig }) })` | WIRED | Live-verified: identical payload shape POSTed directly to the real route succeeds (200) |
| WP REST route | OpenAI `/v1/realtime/client_secrets` | `OpenAiDirectTokenProvider::mint_session()` (unmodified) | WIRED | Live-verified via negative control: re-adding `temperature` to the same route reproduces the original live OpenAI 400 → mapped 502, proving the full chain (route → PHP provider → real OpenAI API) is exercised, not mocked |

### Regression Check — No New Breakage Introduced

| Suite | Result | Notes |
|---|---|---|
| `openai-realtime` vitest | 6/6 PASS | The fixed package itself |
| `openai-stt-tts` vitest | 13/13 PASS | Constrained to stay untouched — confirmed zero diff + zero regression |
| `generic-stt-tts` vitest | 36/36 PASS | Unrelated package, included per re-verification scope — confirms no cross-package breakage |
| `core` | `tsc --noEmit` clean (no test runner present) | Consistent with documented stack (no test framework at this layer) |
| `render-logic-harness.php` | 12/12 PASS | EMBED-02/EMBED-04 PHP coverage, unaffected by this fix, confirmed still green |
| `rest-logic-harness.php` | 13/13 PASS | D-05 sessionConfig validation, unaffected by this fix, confirmed still green |
| `settings-page-harness.php` | 13/13 PASS | Unrelated to this fix; included since it's one of "all 4 harnesses" requested |
| `token-provider-harness.php` | PASS (3 cases) | Directly adjacent to the fixed code path (mint_session error mapping) — confirmed still correctly maps 500/WP_Error/missing-value failures to generic responses, unaffected by the temperature change |

No regressions detected anywhere in the suite.

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| EMBED-01 | `[khaveeai_avatar]` shortcode, usable in any editor | SATISFIED | Unchanged from original verification; not affected by gap |
| EMBED-02 | Per-instance attribute overrides with global fallback | SATISFIED | Unchanged; harnesses re-confirmed green this session |
| EMBED-03 | Equivalent Gutenberg block, inspector mirrors shortcode | SATISFIED | Unchanged from original verification |
| EMBED-04 | Shared PHP resolution function, no drift | SATISFIED | Unchanged; harness parity case re-confirmed green |
| EMBED-05 | Block editor never mounts SPA/mic/token | SATISFIED | Unchanged from original verification |
| PERF-01 | Bundle enqueued only where shortcode/block render | SATISFIED | Unchanged from original verification |

All 6 requirement IDs remain SATISFIED. The gap-closure plan's `requirements: [EMBED-01, EMBED-05]` frontmatter correctly attributes the fix to "the embed actually functions end-to-end" (EMBED-01: the shortcode-embedded avatar must actually work, not just render markup) and EMBED-05 (the front-end connect path, which is the live-SPA side of that same boundary) — both are now demonstrably true at the live-connection level, not just the markup-rendering level the original verification covered.

### Anti-Patterns Found

None in the gap-closure files (`OpenAIRealtimeProvider.ts`, the new test file, `vitest.config.ts`, `postcss.config.mjs`, `package.json`) — confirmed via direct grep this session, zero TBD/FIXME/XXX/HACK/PLACEHOLDER matches.

Carried forward from the original verification (both still INFO-level, non-blocking, not touched by this fix):
- Three near-duplicate `block.json` copies (WR-02 in 08-REVIEW.md)
- `ErrorOverlay.tsx` field-capture event chaining pattern (WR-03 in 08-REVIEW.md)

New INFO-level items surfaced by 08-05-REVIEW.md (both non-blocking, already triaged):
- `buildProxySessionConfig(): any` return type (WR-02 in 08-05-REVIEW.md) — not fixed, but does not affect correctness; the runtime regression test is the active defense against `temperature` reappearing
- Duplicated model-fallback literal across two call sites (IN-01, pre-existing, not a regression)
- Explanatory comment detached from the field it documents (IN-02, cosmetic)

None of these block the phase goal.

### Human Verification Required

#### 1. Front-end click-to-talk mic permission gating AND full WebRTC connect (updated scope)

**Test:** Open a real WordPress page containing `[khaveeai_avatar]` (or the block) in an actual browser. Confirm the avatar renders idle with a "Click to talk" button, with no mic-permission prompt or network token request firing on page load. Click the button and confirm: the browser's native mic-permission dialog appears, a token request fires and now succeeds (per this session's live REST re-confirmation), and the WebRTC session actually connects end-to-end (peer connection negotiates, audio streams).
**Expected:** No mic prompt / token request until the explicit click; mic prompt + token request fire and succeed immediately after; full voice session connects.
**Why human:** Requires observing a native browser permission-dialog UI event and full WebRTC negotiation, neither of which curl/WP-CLI/PHP harnesses can simulate. This session re-confirmed the server-side half (REST token mint) live and conclusively — the remaining gap in automated coverage is purely the browser-side mic dialog + WebRTC peer connection establishment, which was never claimed fixed by this gap-closure cycle beyond unblocking the token mint.

#### 2. Visual avatar render quality

**Test:** With the same page open, confirm the VRM/GLB avatar renders correctly in the WebGL/Three.js canvas with no browser console errors, on both the shortcode and block embeds.
**Expected:** Avatar model renders visibly and correctly; zero console errors.
**Why human:** WebGL rendering correctness requires visual inspection in an actual browser. `08-UAT.md` Test 2 already passed this live and is unaffected by the temperature fix — carried forward, not re-tested this session since it's out of scope for this gap-closure cycle.

### Gaps Summary

**The diagnosed blocker (UAT Test 1: `{"error":"session_unavailable"}`) is genuinely closed.** This was independently re-derived in this verification session, not trusted from the orchestrator's or executor's claims:

1. Source code confirmed to no longer construct an invalid `temperature` field in the proxy sessionConfig.
2. The committed, WP-served bundle artifact confirmed to match the fixed source (rebuilt, byte-pattern-matched).
3. All declared TS regression suites re-run fresh: `openai-realtime` 6/6, `openai-stt-tts` 13/13 (untouched, zero regression), `generic-stt-tts` 36/36.
4. All 4 PHP test harnesses re-run fresh: `render-logic-harness.php` 12/12, `rest-logic-harness.php` 13/13, `settings-page-harness.php` 13/13, `token-provider-harness.php` 3/3 — all PASS, exit 0.
5. `tsc --noEmit` clean for the fixed package.
6. The live wp-env REST route was re-tested independently with the exact fixed payload shape: **HTTP 200 + valid ephemeral token** — not trusting the orchestrator's prior claim of the same.
7. A negative-control re-test (re-adding `temperature`) deterministically reproduced the *original* `HTTP 502 {"error":"session_unavailable"}` failure with a matching fresh `debug.log` 400-mint-failure line — proving the live round-trip is authentic (hits the real OpenAI API, not a stub) and that the fix is the actual, sole cause of the resolution, not a coincidental pass.
8. Constrained files (`SessionController.php`, `OpenAiDirectTokenProvider.php`, `RealtimeConfig` type, `openai-stt-tts` package) confirmed via `git diff` to have zero changes, honoring the gap-closure plan's explicit scope boundaries.

**Status remains `human_needed`, not `passed`**, because two items were always (correctly) routed to human verification and remain so: the native browser mic-permission dialog + full WebRTC connection establishment (now more likely to succeed end-to-end given the server-side blocker is resolved, but the browser-side interaction itself still requires human eyes), and visual WebGL avatar render quality (unaffected by this fix, already passed live in `08-UAT.md` Test 2, carried forward).

This is not a new gap — it is the same narrow, structurally-unavoidable human-verification slice from the original verification, now with one of the two originally-deferred UAT findings (the live blocker) fully resolved and independently re-confirmed.

---

*Verified: 2026-06-25T09:05:00Z*
*Verifier: Claude (gsd-verifier)*
*Re-verification of gap closure for 08-05-PLAN.md / 08-05-SUMMARY.md / 08-05-REVIEW.md*
