---
phase: quick-260712-pt8
plan: 260712-pt8
subsystem: api
tags: [openai-realtime, webrtc, nextjs-route, ephemeral-token]

requires: []
provides:
  - Working ephemeral-token-minting contract for src/app/api/negotiate/route.ts, matching OpenAIRealtimeProvider.connect()'s useProxy expectations
affects: []

tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified: [src/app/api/negotiate/route.ts]

key-decisions:
  - "Ported the request/response contract from wordpress-plugin/includes/TokenProvider/OpenAiDirectTokenProvider.php (the only live-verified reference for this endpoint in the repo) rather than re-deriving it from OpenAI docs, since STATE.md already documents this exact contract was confirmed via live curl during Phase 6"
  - "Tightened error handling to not forward OpenAI's raw response text to the browser on failure (log server-side via console.error only) — matches the PHP reference's documented no-leak invariant (D-10), which the old route violated by returning `error` (OpenAI's raw text) directly to the client"

patterns-established: []

requirements-completed: []

duration: 10min
completed: 2026-07-12
---

# Quick Task 260712-pt8: Fix negotiate route's stale SDP-relay contract Summary

**Rewrote src/app/api/negotiate/route.ts to mint an OpenAI ephemeral session token instead of relaying raw SDP, fixing a 400 invalid_offer error that broke every useProxy-mode OpenAIRealtimeProvider connection in this repo**

## Performance

- **Duration:** 10 min
- **Started:** 2026-07-12T18:35:00+07:00
- **Completed:** 2026-07-12T18:45:00+07:00
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Root-caused the user-reported `400 invalid_offer` error to a protocol mismatch: `OpenAIRealtimeProvider.connect()` (useProxy mode) POSTs `{ sessionConfig }` JSON and expects an ephemeral-token JSON response back, but `src/app/api/negotiate/route.ts` was instead treating the whole POST body as raw SDP text and forwarding it verbatim to OpenAI's old single-shot `/v1/realtime?model=...` endpoint — so a JSON blob got forwarded to an SDP parser, which choked on the opening `"` character exactly as reported
- Confirmed the correct contract via the repo's own live-verified reference (`wordpress-plugin/includes/TokenProvider/OpenAiDirectTokenProvider.php`, built and curl-tested during Phase 6): `POST https://api.openai.com/v1/realtime/client_secrets` with body `{ session: sessionConfig }` (must be nested under a `session` key), returning `{ value, session: { id, ... } }`
- Rewrote the route to mint the token correctly and return `{ data: { ephemeralToken, sessionId } }`, matching `ProxyTokenResponse`'s shape as parsed by `OpenAIRealtimeProvider.connect()` (`packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:17-26, 173-186`)
- Also tightened error handling: the old route echoed OpenAI's raw error text back to the browser; the new route logs the real detail server-side only and returns a generic error, matching the PHP reference's documented no-leak security invariant

## Task Commits

1. **Task 1: Rewrite the negotiate route to mint an ephemeral token instead of relaying SDP** - `3939527` (fix)

## Files Created/Modified
- `src/app/api/negotiate/route.ts` - Rewritten from raw-SDP-relay to ephemeral-token-minting, matching `OpenAIRealtimeProvider`'s actual `useProxy` contract

## Decisions Made
- Ported the contract from the repo's own live-verified PHP reference implementation rather than re-deriving from OpenAI's docs, since it was already confirmed correct via live curl testing (STATE.md:75)
- Tightened error-response handling beyond what the plan strictly required (no longer leaking OpenAI's raw response text to the client) since the PHP reference explicitly documents this as a security invariant (D-10) and the fix was a one-line change already in scope

## Deviations from Plan
None - plan executed exactly as written. Plan was authored directly by the orchestrator (not a spawned `gsd-planner` subagent) since the root cause and correct fix were already fully diagnosed via direct source inspection before planning began — delegating research would have been redundant.

## Issues Encountered
None — this was the actual root blocker for the `openai-avatar-test` demo page added in quick task 260712-mfz; that page's frontend code required no changes.

## User Setup Required
None beyond what already existed (`OPENAI_API_KEY` in the environment) — no new configuration required.

## Next Phase Readiness
- `/openai-avatar-test` and `/openai` should now successfully complete WebRTC negotiation via the proxy instead of failing with a 400 at `/api/negotiate`. Not yet manually re-verified against a live OpenAI account by a human — that's the immediate next step.
