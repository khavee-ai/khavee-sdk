---
phase: 08-frontend-bundle-shortcode-block
verified: 2026-06-25T07:13:21Z
status: human_needed
score: 9/9 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Front-end click-to-talk mic permission gating (browser-only)"
    expected: "On a page with [khaveeai_avatar], the avatar renders idle with a 'Click to talk' button. No mic prompt or token request fires until clicked. After clicking, the browser's native mic permission dialog appears and the token request fires."
    why_human: "Requires a real browser firing getUserMedia() and observing a native OS/browser permission dialog — curl/WP-CLI/PHP harnesses cannot simulate a permission-dialog UI event. Code-level gate (connect() only inside the click handler, no apiKey, no auto-connect) is statically verified; the runtime mic-dialog behavior itself needs human eyes."
  - test: "Visual avatar render quality (VRM/GLB WebGL canvas)"
    expected: "The VRM/GLB avatar renders correctly in the Three.js canvas with no console errors, on both the shortcode and block embeds."
    why_human: "WebGL rendering correctness and absence of browser console errors cannot be verified by HTTP/grep-based checks; requires visually opening the page in a browser."
---

# Phase 8: Frontend Bundle + Shortcode/Block Verification Report

**Phase Goal:** A site owner can embed a fully working voice-chat VRM avatar on any page via shortcode or Gutenberg block, using one shared bundle and shared attribute-resolution logic, loaded only where actually used
**Verified:** 2026-06-25T07:13:21Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Built `khaveeai-bundle.js` scans DOM for `[data-khaveeai-config]` and mounts one independent avatar tree per element, no auto-connect | VERIFIED | `packages/wp-bundle/src/index.ts` — `querySelectorAll('[data-khaveeai-config]')`, per-element `khaveeaiMounted` idempotency guard, try/catch JSON parse. `mount.tsx` constructs a new `OpenAIRealtimeProvider` per call (never module-level). `connect()` only called inside `ClickToTalkOverlay`'s `onClick` (confirmed by reading the component — no module/effect-level `connect()` call). Live-verified on a real wp-env page (see Behavioral Spot-Checks). |
| 2 | Bundle never assigns `window.React`/`window.ReactDOM` (full isolation) | VERIFIED | `node wordpress-plugin/tests/bundle-isolation-check.mjs` re-run by verifier: 4/4 PASS, exit 0. Verifier independently rebuilt the bundle from source (`pnpm --filter @khaveeai/wp-bundle run build`) and confirmed the rebuilt file is byte-identical (md5 match, zero git diff) to the committed artifact, then re-ran the isolation check against the fresh build — still 4/4 PASS. `build.mjs` confirmed to use `format: "iife"` with no `globalName` and no `external` array. |
| 3 | Per-instance voice/instructions reach `sessionConfig.audio.output.voice`/`.instructions` via the provider constructor, no separate `instanceOverrides` field | VERIFIED | `mount.tsx` passes `voice: config.voice, instructions: config.instructions` into `OpenAIRealtimeProvider`'s constructor only. `grep -c "instanceOverrides"` returns 0 across `packages/wp-bundle/src` and `SessionController.php`. Live-verified: a block instance with `{"voice":"echo"}` produced `data-khaveeai-config` with `voice:"echo"` while `instructions`/`avatarUrl` fell back to global. |
| 4 | `[khaveeai_avatar]` shortcode renders a mount-point div with escaped merged config (EMBED-01) | VERIFIED | `AvatarShortcode::render()` → `AvatarRenderer::render()` confirmed wired in `Plugin.php`. Live-verified: created a real WP page with `[khaveeai_avatar]` on a running wp-env instance; fetched the rendered HTML and found `<div id="khaveeai-2" class="khaveeai-root" data-khaveeai-config="...">` with correctly escaped JSON. |
| 5 | Instance attribute overrides win; omitted attributes fall back to global (EMBED-02), validated server-side with allowlist/cap (D-05) | VERIFIED | `render-logic-harness.php` 12/12 PASS (re-run by verifier) covering shortcode override/fallback for voice/instructions/avatar. `rest-logic-harness.php` 17/17 PASS (re-run by verifier) covering allowlisted-voice-honored, malicious-voice-rejected, within-cap/over-cap instructions, multi-byte (Thai) instructions correctly NOT byte-length-rejected (`mb_strlen` fix confirmed present in `SessionController.php:162`), and the no-usable-override regression (Phase 6 D-07 unchanged). Live-verified override on a real page: `voice="echo"` shortcode attribute overrode the global `voice:"marin"`. |
| 6 | Shortcode and block resolve attributes through one shared `AvatarRenderer::render()` (EMBED-04) — cannot drift | VERIFIED | `Plugin.php` constructs exactly one `AvatarRenderer` (`grep -c "new AvatarRenderer"` = 1), reused by both `AvatarShortcode` and `AvatarBlock`. `render-logic-harness.php` contains an explicit shortcode-shaped-vs-block-shaped parity case asserting `===`-identical public-safe output. Live-verified: shortcode page (`voice="echo"`) and block page (`{"voice":"echo"}`) produced byte-identical `data-khaveeai-config` JSON for the same logical input. |
| 7 | Gutenberg block (`khaveeai/avatar`) mirrors shortcode attributes via inspector controls; editor preview never mounts the SPA/mic/token (EMBED-03/EMBED-05) | VERIFIED | `block.json` has no `viewScript`/`render` field (`grep` confirms). `AvatarBlock::render_callback()` delegates to the same `AvatarRenderer`. `src/editor.js` registers `InspectorControls` with a voice `SelectControl` (10 voices + "(using global default)"), `TextareaControl` for instructions, `wp.media`-based `MediaUpload` for avatar, and a `ServerSideRender` preview. `grep -c "RTCPeerConnection" assets/editor.js` = 0; `grep -c "@khaveeai/" src/editor.js` = 0 — structurally impossible for the editor bundle to pull in SPA/mic/WebRTC code. Verifier independently rebuilt `assets/editor.js` from source — byte-identical (md5 match, zero git diff) to the committed copy. |
| 8 | Avatar bundle asset enqueued only on pages with the shortcode/block, never site-wide (PERF-01) | VERIFIED | `grep -rn "wp_enqueue_scripts"` across `wordpress-plugin/includes/` returns 0 hits — no blanket hook exists; `AssetManager::enqueue()` is called only from inside `AvatarRenderer::render()`, idempotently guarded by `wp_script_is()`. Live-verified on a real wp-env instance: created Page A (`[khaveeai_avatar]`) and Page B (plain text, no shortcode); fetched both — Page A's HTML contains the `<script id="khaveeai-bundle-js">` and `<link id="khaveeai-bundle-style-css">` tags plus the mount-point div; Page B's HTML contains zero occurrences of the string `khaveeai` anywhere. |
| 9 | Admin sees an inline "not configured" notice; logged-out visitor sees a neutral inert placeholder with no notice markup (Criterion 6 / D-06/D-07) | VERIFIED | `AvatarRenderer::render()` gates the not-configured branch first on `is_configured()`, then `current_user_can('manage_options')` — the admin-notice markup is structurally absent (not CSS-hidden) outside that branch (`grep` confirms "isn't configured yet" only appears in `render_admin_notice()`). Live-verified: cleared the live `api_key` option on the running wp-env instance, fetched the embed page as a logged-out visitor (saw only `khaveeai-placeholder` SVG, zero notice text), then fetched the same page as an authenticated admin (cookie-login confirmed via Dashboard fetch) and saw `notice notice-warning` + "isn't configured yet" + "Go to Settings" markup. No raw API key string found in either response. Settings fully restored afterward; test pages deleted. |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/wp-bundle/package.json` | `@khaveeai/wp-bundle`, react/react-dom as direct deps, no main/types/exports | VERIFIED | Confirmed exact shape; `private: true`; no peerDependencies |
| `packages/wp-bundle/build.mjs` | esbuild IIFE, no globalName, no external | VERIFIED | `format: "iife"`, no globalName/external present |
| `packages/wp-bundle/src/index.ts` | DOM scan-and-mount entry | VERIFIED | Matches spec exactly, idempotency guard present |
| `packages/wp-bundle/src/mount.tsx` | Per-instance provider + KhaveeProvider + avatar render tree | VERIFIED | Constructs provider per call; `useProxy: true` always; no `apiKey` reference |
| `packages/wp-bundle/src/ui/ClickToTalkOverlay.tsx` | Click-gated connect() | VERIFIED | `connect()` only in `onClick`; exact copy "Click to talk"/"Connecting…" present |
| `packages/wp-bundle/src/ui/ErrorOverlay.tsx` | Generic error + retry | VERIFIED | "Couldn't connect"/"Try again" present; chains onto `onError` |
| `packages/wp-bundle/styles.css` | UI-SPEC tokens | VERIFIED | `#2271b1`, `rgba(30,30,30,0.55)`, `inherit`, 44px min-height present |
| `wordpress-plugin/build/khaveeai-bundle.js` (+`.css`) | Committed built IIFE bundle | VERIFIED | Exists, 1.36MB; not gitignored (`git check-ignore` returns nothing); rebuild-from-source produces byte-identical md5 |
| `wordpress-plugin/tests/bundle-isolation-check.mjs` | D-10 isolation smoke check | VERIFIED | Re-run by verifier: 4/4 PASS, exit 0 |
| `wordpress-plugin/includes/Render/AvatarRenderer.php` | Shared render path | VERIFIED | `wp_parse_args`, `esc_attr(wp_json_encode(...))`, `is_configured`, `current_user_can('manage_options')`, `public_safe()` whitelist confirmed; `get_api_key` never referenced |
| `wordpress-plugin/includes/Assets/AssetManager.php` | Idempotent conditional enqueue | VERIFIED | `wp_script_is()` guard present; empty deps array; no `wp_enqueue_scripts` hook |
| `wordpress-plugin/includes/Shortcode/AvatarShortcode.php` | `[khaveeai_avatar]` adapter | VERIFIED | `add_shortcode`, `shortcode_atts`, `array_filter` empty-string strip, delegates to renderer |
| `wordpress-plugin/includes/Block/block.json` | Block metadata, no viewScript/render | VERIFIED | Valid JSON; attributes mirror shortcode 1:1; no `viewScript`/`render` keys |
| `wordpress-plugin/includes/Block/AvatarBlock.php` | `register_block_type` + render_callback | VERIFIED | Delegates to the same shared `AvatarRenderer`; filters empty/zero attrs identically to shortcode |
| `wordpress-plugin/assets/editor.js` (+`.asset.php`) | Built editor bundle, zero SPA imports | VERIFIED | `RTCPeerConnection` count 0; rebuild-from-source byte-identical to committed copy |
| `wordpress-plugin/includes/Rest/SessionController.php` | `ALLOWED_VOICES`/`MAX_INSTRUCTIONS_LENGTH` D-05 validation | VERIFIED | Confirmed `mb_strlen` (not `strlen`) used for the cap — WR-01 fix present; strict `in_array(..., true)` for voice |
| `wordpress-plugin/tests/render-logic-harness.php` | EMBED-02/EMBED-04 coverage | VERIFIED | Re-run by verifier: 12/12 PASS |
| `wordpress-plugin/tests/rest-logic-harness.php` | D-05 sessionConfig validation coverage | VERIFIED | Re-run by verifier: 17/17 PASS, including the Thai multi-byte instructions case |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `mount.tsx` | `OpenAIRealtimeProvider` | constructor `useProxy: true, proxyEndpoint, voice, instructions` | WIRED | Confirmed in source; no `apiKey` |
| mount-point config | `sessionConfig.audio.output.voice`/`.instructions` | provider's internal `connect()` (unmodified) | WIRED | Confirmed via Phase-6 provider contract notes in plan + live REST response shape (`Cache-Control: no-store` header present, confirming the route executes) |
| `build.mjs` | `wordpress-plugin/build/khaveeai-bundle.js` | esbuild outfile | WIRED | Confirmed by rebuild-and-diff (byte-identical) |
| `AssetManager.php` | `khaveeai.php` constants | `KHAVEEAI_PLUGIN_FILE`/`KHAVEEAI_VERSION` | WIRED | Both constants defined before `plugins_loaded` hook; `php -l` clean |
| `AvatarShortcode.php` | `AvatarRenderer.php` | `$this->renderer->render($atts)` | WIRED | Confirmed in source and live HTTP response |
| `AvatarRenderer.php` | `AssetManager.php` | `$this->assets->enqueue()` inside `render()` | WIRED | Confirmed in source; PERF-01 live-verified (Page A vs Page B test) |
| `AvatarBlock.php` | `AvatarRenderer.php` | `render_callback` → `$this->renderer->render($attributes)` | WIRED | Confirmed in source and live block-rendered page parity test |
| `editor.js` | `AvatarBlock::render_callback` (server) | `ServerSideRender block="khaveeai/avatar"` | WIRED | Confirmed `ServerSideRender` import + usage in `src/editor.js`; this is the REST `block-renderer` endpoint the prior checkpoint session hit directly and confirmed returns only a static div fragment, no script tag |
| `Plugin.php` | `AvatarBlock.php`/`AvatarShortcode.php` | single shared `$renderer`, `add_action('init', ...)` | WIRED | Confirmed exactly one `new AvatarRenderer` call site in `Plugin.php` |

### Behavioral Spot-Checks (Live wp-env Instance)

A wp-env Docker stack (`wp-env-wordpress-plugin-d9d2827f-*`, already running, 3+ days uptime) was used to independently re-verify runtime behavior, rather than trusting 08-04-SUMMARY.md's checkpoint-resolution narrative alone. All checks below were executed fresh by the verifier in this session (new test pages created, exercised, then deleted; settings backed up, mutated, and restored).

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| PERF-01: bundle absent on a page without the shortcode/block | Created Page B (plain text), fetched HTML, grepped for `khaveeai` | 0 matches | PASS |
| PERF-01: bundle present on a page with the shortcode | Created Page A (`[khaveeai_avatar]`), fetched HTML | `<script id="khaveeai-bundle-js">`, `<link id="khaveeai-bundle-style-css">`, mount-point div all present | PASS |
| EMBED-02: shortcode voice override | Page C with `[khaveeai_avatar voice="echo"]` | `data-khaveeai-config` shows `voice:"echo"`, `instructions`/`avatarUrl` fall back to global | PASS |
| EMBED-03/EMBED-04: block parity | Page D with `<!-- wp:khaveeai/avatar {"voice":"echo"} /-->` | `data-khaveeai-config` byte-identical to Page C's shortcode output for the same logical input | PASS |
| Criterion 6: visitor placeholder when unconfigured | Cleared live `api_key`, fetched as logged-out visitor | Only `khaveeai-placeholder` SVG, zero notice text | PASS |
| Criterion 6: admin notice when unconfigured | Same state, fetched as cookie-authenticated admin | `notice notice-warning` + "isn't configured yet" + "Go to Settings" present; no raw API key in response | PASS |
| Bundle isolation (D-10) after fresh rebuild | `pnpm --filter @khaveeai/wp-bundle run build` then `node bundle-isolation-check.mjs` | Rebuilt bundle byte-identical (md5) to committed copy; isolation check 4/4 PASS | PASS |
| Editor bundle reproducibility | `npm run build` inside `wordpress-plugin/` | Rebuilt `assets/editor.js` byte-identical (md5) to committed copy | PASS |

**Not verified (filed as human-UAT, correctly not silently dropped by the executor):** the literal browser click + native mic-permission-dialog interaction, and visual WebGL avatar render quality. These require a real browser and cannot be exercised via curl/WP-CLI/PHP. See `08-HUMAN-UAT.md`.

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| `wordpress-plugin/tests/bundle-isolation-check.mjs` | `node wordpress-plugin/tests/bundle-isolation-check.mjs` | 4/4 PASS, exit 0 | PASS |
| `wordpress-plugin/tests/render-logic-harness.php` | `php wordpress-plugin/tests/render-logic-harness.php` | 12/12 PASS, exit 0 | PASS |
| `wordpress-plugin/tests/rest-logic-harness.php` | `php wordpress-plugin/tests/rest-logic-harness.php` | 17/17 PASS, exit 0 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| EMBED-01 | 08-02 | `[khaveeai_avatar]` shortcode, usable in any editor | SATISFIED | Live-verified render on a real WP page; harness coverage |
| EMBED-02 | 08-02, 08-03 | Per-instance attribute overrides with global fallback | SATISFIED | Live-verified override+fallback; 12+17 harness cases; D-05 server-side validation confirmed (mb_strlen fix) |
| EMBED-03 | 08-04 | Equivalent Gutenberg block, inspector mirrors shortcode | SATISFIED | `src/editor.js` InspectorControls with voice/instructions/avatar; live block-rendered parity test |
| EMBED-04 | 08-02, 08-04 | Shared PHP resolution function, no drift | SATISFIED | Single `AvatarRenderer` instance reused by both adapters; harness parity case; live byte-identical output for matching shortcode/block input |
| EMBED-05 | 08-01, 08-04 | Block editor never mounts SPA/mic/token | SATISFIED | `block.json` no viewScript/render; `render_callback` is the editor preview source via `ServerSideRender`; zero `@khaveeai/*` imports / zero `RTCPeerConnection` in editor bundle; prior checkpoint session independently confirmed the live REST block-renderer endpoint returns only a static div |
| PERF-01 | 08-01, 08-02 | Bundle enqueued only where shortcode/block render | SATISFIED | No `wp_enqueue_scripts` hook anywhere; render-path-triggered, idempotent enqueue; live-verified absent on a non-embed page and present on an embed page |

No orphaned requirements: all 6 Phase-8 requirement IDs (EMBED-01 through EMBED-05, PERF-01) appear in at least one plan's `requirements:` frontmatter and are independently corroborated by code + live evidence above. `ASSET-01` is correctly scoped to Phase 7 per `.planning/REQUIREMENTS.md`'s traceability table, not Phase 8 — its absence here is expected, not a gap.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `wordpress-plugin/assets/block.json`, `wordpress-plugin/src/block.json`, `wordpress-plugin/includes/Block/block.json` | n/a | Three near-duplicate `block.json` copies, only one load-bearing | INFO (WR-02 in 08-REVIEW.md, already triaged non-blocking) | Future schema edits to one copy risk silent drift; not currently causing incorrect behavior — confirmed `includes/Block/block.json` is the only one `register_block_type()` reads |
| `packages/wp-bundle/src/ui/ErrorOverlay.tsx` | 25-37 | Field-capture event chaining on a mutable shared provider field (`onError`) | INFO (WR-03 in 08-REVIEW.md, pre-existing codebase pattern, not introduced fresh) | Fragile if a future third subscriber assigns `.onError` directly instead of chaining; no functional defect today |

No TBD/FIXME/XXX/HACK/PLACEHOLDER markers found in any file modified by this phase (`packages/wp-bundle/src/*`, `wordpress-plugin/includes/{Render,Assets,Shortcode,Block,Rest}/*`, `wordpress-plugin/khaveeai.php`, `wordpress-plugin/src/editor.js`). No critical/blocking anti-patterns found.

### Human Verification Required

#### 1. Front-end click-to-talk mic permission gating

**Test:** Open a real WordPress page containing `[khaveeai_avatar]` (or the block) in an actual browser. Confirm the avatar renders idle with a "Click to talk" button, with no mic-permission prompt or network token request firing on page load. Click the button and confirm the browser's native mic-permission dialog appears and a token request fires only then.
**Expected:** No mic prompt / token request until the explicit click; mic prompt + token request fire immediately after.
**Why human:** Requires observing a native browser permission-dialog UI event, which cannot be triggered or inspected via curl/WP-CLI/PHP harnesses. The code-level gate (connect() only inside the click handler, no auto-connect, no embedded apiKey) is statically and structurally verified in this report — this item is a confirmatory visual/interactive spot-check, not a sign of missing implementation.

#### 2. Visual avatar render quality

**Test:** With the same page open, confirm the VRM/GLB avatar renders correctly in the WebGL/Three.js canvas with no browser console errors, on both the shortcode and block embeds.
**Expected:** Avatar model renders visibly and correctly; zero console errors.
**Why human:** WebGL rendering correctness and absence of console errors require visual inspection in an actual browser; not assertable via HTTP-level checks.

### Gaps Summary

No gaps. All 9 derived observable truths and all 6 phase requirement IDs (EMBED-01 through EMBED-05, PERF-01) are verified against the actual codebase — not merely the SUMMARY.md narrative. Verification included: re-running all three test harnesses fresh (33 total automated cases, all passing), independently rebuilding both the front-end bundle and the editor bundle from source and confirming byte-identical output to the committed artifacts (ruling out staleness per 08-REVIEW.md's IN-01/IN-02 concerns), and exercising the live wp-env WordPress instance directly (new test pages, real HTTP fetches, a real admin login, and a real settings mutation/restore cycle) rather than trusting the prior session's checkpoint-resolution claims at face value.

The two items routed to human verification are intentionally narrow: a native browser mic-permission dialog and visual WebGL rendering, neither of which is assertable by any automated check available in this environment. Per the decision tree, the presence of these items — even with a 9/9 truths score and zero code-level gaps — requires `status: human_needed` rather than `passed`.

WR-01 (byte-vs-character length mismatch for Thai instructions, flagged Warning in 08-REVIEW.md) was confirmed fixed in the actual `SessionController.php` source (`mb_strlen` in place of `strlen`), with a dedicated passing harness case exercising the exact multi-byte scenario — this was independently re-derived from source, not assumed from the SUMMARY's claim.

---

*Verified: 2026-06-25T07:13:21Z*
*Verifier: Claude (gsd-verifier)*
