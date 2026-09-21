---
phase: 18-facial-performance-eyes-visemes-emotion
plan: 06
subsystem: animation
tags: [react, vrm, three-vrm, eye-gaze, viseme, emotion, tool-calling, verification]

# Dependency graph
requires:
  - phase: 18-facial-performance-eyes-visemes-emotion
    plan: 01
    provides: "eyeGaze.ts, LookAtController structural type, getLookAt adapter slot"
  - phase: 18-facial-performance-eyes-visemes-emotion
    plan: 02
    provides: "createEmotionTool/emotionSystemPrompt/EMOTION_NAMES in @khaveeai/core"
  - phase: 18-facial-performance-eyes-visemes-emotion
    plan: 03
    provides: "viseme.ts VISEME_KEYS/VisemeChannel"
  - phase: 18-facial-performance-eyes-visemes-emotion
    plan: 04
    provides: "useAnimationController steps 12-14 (eye-gaze/viseme/emotion) and emotionHint/onEmotionConsumed/visemeChannel/getNowMs params"
  - phase: 18-facial-performance-eyes-visemes-emotion
    plan: 05
    provides: "KhaveeProvider emotionHint/setEmotionHint/visemeChannel context, useRealtime hybrid viseme feed"
provides:
  - "VRMAvatar wired end-to-end: real vrm.lookAt eye gaze, emotion hint consumption, viseme mouth ownership"
  - "@khaveeai/react exports EmotionHint/EmotionName/VisemeChannel public types"
  - "openai-avatar-test playground page exercises the set_emotion tool end-to-end plus six manual emotion buttons"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-owner-per-frame skip pattern: a Set of reserved expression names checked before a legacy per-frame lerp loop touches them, gated on a stateful channel's isActive(nowMs) rather than a boolean prop"

key-files:
  created: []
  modified:
    - packages/react/src/VRMAvatar.tsx
    - packages/react/src/index.ts
    - apps/playground/src/app/openai-avatar-test/page.tsx

key-decisions:
  - "getLookAt returns currentVrm?.lookAt directly (no wrapping/adaptation) — three-vrm's VRMLookAt already structurally satisfies the LookAtController interface declared in animation/types.ts, so no adapter shim was needed"
  - "VISEME_KEY_SET is built once at module scope from the existing VISEME_KEYS tuple (viseme.ts) rather than duplicating the 5 mouth-shape names in VRMAvatar.tsx, keeping one source of truth"
  - "The playground's emotion buttons pass a fixed intensity of 0.8 (matching the plan's <action> instruction) rather than exposing an intensity slider, since the goal is deterministic EMO-02/03 verification, not a tuning UI"

requirements-completed: [EYE-01, EYE-02, VIS-01, VIS-02, VIS-03, VIS-04, EMO-01, EMO-02, EMO-03]

# Metrics
duration: ~20min (Tasks 1-2; Task 3 is a pending human checkpoint)
completed: 2026-09-21
---

# Phase 18 Plan 06: VRMAvatar Wiring + Playground Verification Surface Summary

**VRMAvatar now drives real eye contact through vrm.lookAt, consumes LLM emotion hints, and hands mouth ownership to the viseme layer while it has data; the openai-avatar-test page registers the zero-config set_emotion tool and offers six manual emotion buttons — implementation complete, human visual sign-off still pending.**

## Performance

- **Duration:** ~20 min (Tasks 1-2 automated work)
- **Started:** 2026-09-21 (session start)
- **Completed (implementation):** 2026-09-21T04:48:00Z
- **Tasks:** 3/3 complete
- **Files modified:** 3

## Accomplishments

- `VRMAvatar.tsx`'s `vrmAdapter` gains `getLookAt: () => currentVrm?.lookAt ?? null` (D-04), giving eye-gaze its primary real-VRM path — `three-vrm`'s `VRMLookAt` already structurally matches the `LookAtController` interface, so no shim was required.
- `emotionHint`, `setEmotionHint`, and `visemeChannel` are now destructured from `useKhavee()` and threaded into `useAnimationController` as `emotionHint`, `onEmotionConsumed: () => setEmotionHint(null)`, and `visemeChannel`.
- The legacy per-frame expression lerp in `useFrame` now checks `visemeChannel.isActive(performance.now())` and skips the 5 fixed viseme mouth-shape names (`aa`/`ih`/`ou`/`ee`/`oh`, from the existing `VISEME_KEYS` tuple in `viseme.ts`) while the channel has recent data (D-08) — the mixer.update -> controller.update -> currentVrm.update frame-ordering contract is unchanged, and no code anywhere sets `lookAt.target`.
- `@khaveeai/react`'s `index.ts` now exports `EmotionHint`, `EmotionName` (from `./animation/emotion`) and `VisemeChannel` (from `./animation/viseme`) as public types.
- `apps/playground/src/app/openai-avatar-test/page.tsx`: the module-scope `OpenAIRealtimeProvider`'s `instructions` now appends `emotionSystemPrompt`; a second `useEffect` registers `createEmotionTool(setEmotionHint).tool` (D-11 zero-config path, no hand-written `execute`, mirroring but distinct from the existing `toolGesture` registration); a new button row maps over `EMOTION_NAMES` to call `setEmotionHint(name, 0.8)` for deterministic EMO-02/03 verification; the intro paragraph now names all four Phase 18 things to watch for (eyes/saccades/blinks, smoother mouth+jaw, emotion crossfade with sad/thinking eye shifts and happy-triggers-nod).
- Full `packages/react` suite: 289/289 passing, `tsc --noEmit` clean, `pnpm --filter @khaveeai/react build` exits 0.
- `packages/core` test suite: 23/23 passing. `packages/providers/generic-stt-tts` vitest suite: 40/40 passing (includes the Phase 18 `onViseme forwarding` tests).
- Playground `tsc --noEmit`: zero errors attributable to `openai-avatar-test/page.tsx` (one pre-existing, unrelated error in `generic-demo/__tests__/roundtrip-audio-contract.test.ts` — missing `vitest` type declarations — is out of scope for this plan). `eslint` on the modified page file passes with no output.
- No dev server was started at any point.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire VRMAvatar (lookAt adapter, emotion/viseme params, mouth-key ownership) and export public types** - `829a349` (feat)
2. **Task 2: Expose Phase 18 on the openai-avatar-test verification page** - `a085d83` (feat)
3. **Task 3: Human verification checkpoint** — `589deb8` (fix: bidirectional nod/shake) + APPROVED

**Checkpoint verdict (2026-09-21):** User approved all 8 steps. Two issues raised during verification — nod/shake gestures were unidirectional (single half-sine bump) — fixed in `589deb8` by switching to a windowed bidirectional envelope `sin(2πt)·sin(πt)` with smooth easing at both endpoints. Re-verified and approved.

## Files Created/Modified

- `packages/react/src/VRMAvatar.tsx` - `getLookAt` adapter method; `emotionHint`/`setEmotionHint`/`visemeChannel` destructured from `useKhavee()` and passed into `useAnimationController`; `useFrame`'s legacy expression lerp skips viseme-owned mouth keys while the channel is active; new module-level `VISEME_KEY_SET`
- `packages/react/src/index.ts` - new `EmotionHint`/`EmotionName`/`VisemeChannel` type exports grouped with a Phase 18 comment
- `apps/playground/src/app/openai-avatar-test/page.tsx` - core import extended with `createEmotionTool`/`emotionSystemPrompt`/`EMOTION_NAMES`; provider `instructions` appends `emotionSystemPrompt`; new emotion-tool registration effect; six manual emotion buttons; intro copy extended

## Decisions Made

- `getLookAt` returns `currentVrm?.lookAt` with no wrapping — three-vrm's `VRMLookAt` already satisfies the locally-declared structural `LookAtController` interface (`autoUpdate`/`yaw`/`pitch`/`lookAt()`), so introducing an adapter object would have been unnecessary indirection.
- Reused the existing `VISEME_KEYS` tuple from `viseme.ts` (built into a `Set` once at module scope) rather than hardcoding a second copy of the 5 mouth-shape names in `VRMAvatar.tsx`, keeping a single source of truth per D-08's intent.
- Emotion buttons use a fixed 0.8 intensity (per the plan's explicit instruction) rather than a slider — the buttons exist purely to make EMO-02/03 deterministically testable without depending on the LLM, not to be a tuning UI.

## Deviations from Plan

None - Tasks 1 and 2 executed exactly as written. All acceptance-criteria greps and automated verification commands passed on first attempt.

One out-of-scope, pre-existing item was observed and left untouched per the scope-boundary rule:

- `git diff --quiet main -- packages/providers/openai-stt-tts` reports a diff, but it is a single pre-existing `package.json` version-number line (`"version": "0.3.1"` on `main` vs `"0.3.0"` on this branch) that predates both of this plan's commits (`829a349`, `a085d83` touch no files under `packages/providers/openai-stt-tts`). Not caused by this plan; not fixed, per the scope-boundary rule (pre-existing, unrelated to current task files). Logged here rather than in `deferred-items.md` since it is a single-line version metadata drift with no functional effect, not a bug.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. The pending item is the human-verify checkpoint (Task 3), not an external service.

## Threat Flags

None found. Both files' new surface (the `set_emotion` tool registration and the manual emotion buttons) is already covered by this plan's own threat register (T-18-03 mitigated via `createEmotionTool`'s unmodified validation path, T-18-13/T-18-14 accepted) — no new trust boundary was introduced beyond what the plan anticipated.

## Known Stubs

None. `EMOTION_NAMES.map(...)` renders one real, functional button per emotion name backed by the real `setEmotionHint` setter; no placeholder or hardcoded-empty data paths were introduced.

## Next Phase Readiness

- All 3 tasks complete. All automated gates pass: `@khaveeai/core` (23/23), `@khaveeai/react` (289/289), `@khaveeai/providers-generic-stt-tts` (40/40) vitest suites; `@khaveeai/core` and `@khaveeai/react` `tsc`/build; `openai-stt-tts` untouched by this plan's commits.
- Human checkpoint (Task 3) resolved: APPROVED (2026-09-21). All 8 verification steps passed after the nod/shake bidirectional fix (`589deb8`).
- Phase 18 (6/6 plans) is ready for code review gate and phase completion.

## Self-Check: PASSED

Both modified `packages/react` files and the playground page verified present on disk with the expected content (all acceptance-criteria `grep` patterns matched below); both commit hashes (`829a349`, `a085d83`) verified present in `git log --oneline`.

```
829a349 feat(18-06): wire VRMAvatar eye-gaze/emotion/viseme and export public types
a085d83 feat(18-06): expose emotion tool and manual triggers on avatar test page
```

---
*Phase: 18-facial-performance-eyes-visemes-emotion*
*Completed: 2026-09-21 (all 3 tasks, checkpoint approved)*
