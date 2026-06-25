---
status: diagnosed
trigger: "UAT Phase 8 Test 1: clicking 'Click to talk' returns {\"error\":\"session_unavailable\"} instead of minting a session successfully"
created: 2026-06-25T08:24:57Z
updated: 2026-06-25T08:55:00Z
---

## Current Focus

CONFIRMED ROOT CAUSE — no further investigation needed.

hypothesis: OpenAIRealtimeProvider.connect() (packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:145) unconditionally includes `temperature: this.config.temperature ?? 0.8` as a top-level field inside `sessionConfig.session` when useProxy mode builds the request body sent to the WP proxy. SessionController/OpenAiDirectTokenProvider intentionally pass non-trust-model fields through verbatim (per Phase 6 D-07/D-08 design) and forward this `temperature` field straight to OpenAI's real `/v1/realtime/client_secrets` endpoint, which rejects it with `400 Unknown parameter: 'session.temperature'`. curl-verify.sh and rest-logic-harness.php (and Phase 6's live verification) only ever sent minimal sessionConfig bodies (`{"type":"realtime"}`) with no `temperature` field, so this path was never exercised before the real front-end bundle started constructing the full sessionConfig.
test: Replayed the real wp-env instance's debug.log (showed repeated "OpenAI token mint failed (HTTP 400)"); reconstructed the EXACT sessionConfig payload OpenAIRealtimeProvider.connect() builds (including temperature:0.8) and POSTed it directly to https://api.openai.com/v1/realtime/client_secrets using the real configured API key (164 chars, from wp-env's khaveeai_settings) -> got back HTTP 400 `{"error":{"message":"Unknown parameter: 'session.temperature'.","param":"session.temperature","code":"unknown_parameter"}}`. Removed only the `temperature` field, re-sent identical payload otherwise -> got back HTTP 200 with a valid `ek_`-prefixed ephemeralToken and full session object.
expecting: n/a — directly confirmed via live OpenAI API round-trip, not inference.
next_action: n/a — diagnosis complete, returning to caller for plan-phase --gaps fix.

## Symptoms

expected: Clicking "Click to talk" mints a session and connects without error. Avatar renders idle with "Click to talk" overlay. After clicking: mic prompt appears, "Connecting..." shows, a request to /wp-json/khaveeai/v1/session fires and succeeds.
actual: User clicked "Click to talk" on a live WordPress page embedding [khaveeai_avatar] (wp-env Docker, localhost:8888) and got back: {"error":"session_unavailable"}
errors: "{\"error\":\"session_unavailable\"}"
reproduction: Test 1 in .planning/phases/08-frontend-bundle-shortcode-block/08-UAT.md
started: Discovered during UAT for Phase 8 (frontend bundle, shortcode, Gutenberg block). Pre-existing OpenAI API key confirmed present (164 chars, non-empty) in khaveeai_settings. REST route/rate-limiter/SessionController logic previously verified via curl/WP-CLI during Phase 8 checkpoint resolution — bug only manifests via real browser fetch() from the front-end bundle.

## Eliminated

- hypothesis: Invalid/unrecognized `model: "gpt-realtime-1.5"` value causes OpenAI to reject the request.
  evidence: "gpt-realtime-1.5" is the deliberately-chosen, documented model id (matches OpenAIRealtimeProvider.ts:142 and WpOptionsConfigSource's DEFAULT_MODEL, confirmed in .planning/phases/06-.../06-01-PLAN.md:71 and 06-04-PLAN.md:99's live-verified curl run). Direct curl reproduction with this exact model id succeeded (200) once `temperature` was removed — model name is not the issue.
  timestamp: 2026-06-25T08:50:00Z

- hypothesis: Voice allowlist mismatch between SettingsPage::VOICES and SessionController::ALLOWED_VOICES causes apply_trust_model() to silently reject a valid voice.
  evidence: Both constant arrays are byte-for-byte identical (10 entries: alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar). Configured voice in the live wp-env instance ("marin") is in both lists. Not the cause.
  timestamp: 2026-06-25T08:48:00Z

- hypothesis: Admin-configured `instructions` exceeds SessionController::MAX_INSTRUCTIONS_LENGTH (2000 chars), causing apply_trust_model()'s candidate-vs-fallback logic to misbehave.
  evidence: Live wp-env khaveeai_settings.instructions = "test1213" (8 chars) — far under the cap. Also, even if over-cap, both the rejected candidate AND the fallback resolve to the same admin-configured value, so this code path can't actually produce a different/invalid string either way. Not the cause.
  timestamp: 2026-06-25T08:49:00Z

## Evidence

- timestamp: 2026-06-25T08:24:57Z
  checked: grep for "session_unavailable" across wordpress-plugin/, packages/, src/
  found: Exact string only appears once: wordpress-plugin/includes/Rest/SessionController.php:243 -> `return $this->respond( array( 'error' => 'session_unavailable' ), 502 );` — thrown when token_provider->mint_session() raises TokenMintException.
  implication: Request reached create_session(), passed rate-limit and API-key checks, called mint_session(), which threw. Failure is in the OpenAI mint call itself, not route/auth/WP-REST plumbing.

- timestamp: 2026-06-25T08:35:00Z
  checked: OpenAiDirectTokenProvider.php mint_session() implementation
  found: Three possible TokenMintException triggers: wp_remote_post WP_Error, non-2xx HTTP status, or missing `value` field in 2xx body. All three log a one-line error_log() with real detail server-side only (D-10), never surfaced to caller.
  implication: Need server-side debug.log to see which of the three triggered, and what real HTTP status/detail OpenAI returned.

- timestamp: 2026-06-25T08:36:00Z
  checked: packages/wp-bundle/src/mount.tsx and packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:136-199 (the real client code path that builds and POSTs sessionConfig to the proxy)
  found: The real bundle's sessionConfig (built inside OpenAIRealtimeProvider.connect() when useProxy+proxyEndpoint are set) includes `type`, `model`, `instructions`, `temperature: this.config.temperature ?? 0.8`, `output_modalities: ["audio"]`, `audio.input.transcription`, `audio.output.format/voice/speed`. This is far richer than any payload exercised by curl-verify.sh (`{"type":"realtime"}` only) or rest-logic-harness.php fixtures.
  implication: Strong candidate: a field present only in the real bundle's payload and never exercised by curl/harness tests is the trigger. apply_trust_model() (PHP) only touches instructions/voice — everything else passes through verbatim to OpenAI per documented Phase 6 design (06-REVIEW.md, 06-PATTERNS.md D-07/D-08), so the bug is upstream of PHP if a field itself is invalid against OpenAI's real schema.

- timestamp: 2026-06-25T08:42:00Z
  checked: wp-env Docker WordPress container (wp-env-wordpress-plugin-d9d2827f-wordpress-1) wp-content/debug.log via docker exec
  found: Six repeated lines: "khaveeai: OpenAI token mint failed (HTTP 400)" timestamped across multiple UAT attempts (07:11, 07:55, 08:08 UTC on 25-Jun-2026).
  implication: Confirms OpenAI itself is rejecting the request with HTTP 400 (client error / malformed request), consistently and repeatably — not a network/timeout/auth issue (would be a WP_Error or 401/403, not 400 "Unknown parameter" pattern typical of OpenAI's API).

- timestamp: 2026-06-25T08:45:00Z
  checked: docker exec into cli container, read khaveeai_settings via wp-cli: api_key (164 chars, real sk-proj- key), instructions="test1213", voice="marin", model="gpt-realtime-1.5", avatar_attachment_id=8
  found: Settings are valid, non-empty, all within allowlists/caps.
  implication: Eliminates "misconfigured settings" as the cause — the API key, voice, and instructions are all individually valid.

- timestamp: 2026-06-25T08:50:00Z
  checked: Direct curl POST to https://api.openai.com/v1/realtime/client_secrets using the real configured API key, reconstructing the EXACT sessionConfig the bundle sends (session.type, model, instructions, temperature:0.8, output_modalities, audio.input.transcription, audio.output.format/voice/speed), wrapped under top-level "session" key per the existing (already-fixed) wrapping convention.
  found: HTTP 400 — `{"error":{"message":"Unknown parameter: 'session.temperature'.","type":"invalid_request_error","param":"session.temperature","code":"unknown_parameter"}}`
  implication: Direct, unambiguous reproduction of the exact failure mode against the real OpenAI endpoint with the real key. `temperature` is the offending field.

- timestamp: 2026-06-25T08:52:00Z
  checked: Repeated the identical curl POST with ONLY the `temperature` field removed from the same sessionConfig.
  found: HTTP 200 with a valid `ek_`-prefixed ephemeralToken and a full `session` object echoing all other fields (model, output_modalities, instructions, audio.input/output, voice "marin", etc.) back correctly.
  implication: CONFIRMED — `temperature` is the sole cause. Every other field the bundle sends (model "gpt-realtime-1.5", output_modalities, audio.input.transcription, audio.output.format/voice/speed) is accepted by OpenAI's real /v1/realtime/client_secrets schema. OpenAI's realtime session-creation schema does not support `temperature` as a session-level parameter (unlike the Chat Completions API), and `OpenAIRealtimeProvider.connect()`'s useProxy code path (packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:145) unconditionally adds it with a `?? 0.8` default, so it is ALWAYS present on every request through the proxy/useProxy path, regardless of whether the caller's RealtimeConfig set `temperature`.

## Resolution

root_cause: |
  packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:145 unconditionally sets
  `temperature: this.config.temperature ?? 0.8` inside the `sessionConfig` object built and POSTed
  to the proxy endpoint whenever `useProxy && proxyEndpoint` are set (the exact code path the WP
  plugin's bundle uses, per packages/wp-bundle/src/mount.tsx). This sessionConfig is forwarded
  verbatim (minus instructions/voice trust-model overrides) by
  wordpress-plugin/includes/TokenProvider/OpenAiDirectTokenProvider.php to OpenAI's real
  POST /v1/realtime/client_secrets endpoint. That endpoint's actual schema (confirmed via live
  curl with the real configured API key) does NOT accept `temperature` as a session-level field —
  it returns `400 Unknown parameter: 'session.temperature'`, which OpenAiDirectTokenProvider maps to
  a generic TokenMintException (D-09: no detail leaked), which SessionController::create_session()
  catches and turns into the public-facing `{"error":"session_unavailable"}` 502 response observed
  during UAT.

  This was never caught by curl-verify.sh, rest-logic-harness.php, or Phase 6's live curl
  verification because all of those constructed minimal/hand-crafted sessionConfig test bodies
  (e.g. `{"type":"realtime"}`) that never included a `temperature` field — only the real front-end
  bundle (via OpenAIRealtimeProvider.connect()'s useProxy branch) actually builds and sends the
  full sessionConfig shape that includes it.
fix: |
  Not applied (find_root_cause_only mode). Suggested direction: remove the `temperature` field (or
  make it conditional on a future API surface that supports it) from the sessionConfig object built
  in OpenAIRealtimeProvider.connect()'s useProxy branch (OpenAIRealtimeProvider.ts:140-163),
  OR strip/whitelist unsupported fields server-side in OpenAiDirectTokenProvider before forwarding
  to OpenAI. The TypeScript provider is the source of the invalid field and is the most direct fix
  point; CLAUDE.md's compatibility constraint says `openai-stt-tts` must stay untouched this
  milestone, but `openai-realtime`'s useProxy sessionConfig-building code is not under that
  constraint and is the one place this field gets injected.
verification: |
  Root cause confirmed via direct live reproduction against the real OpenAI endpoint (not
  inference): identical payload with temperature present -> 400; identical payload with
  temperature removed -> 200 + valid ephemeralToken. No fix has been applied yet (diagnose-only
  mode) — verification of an actual fix is out of scope for this session.
files_changed: []
