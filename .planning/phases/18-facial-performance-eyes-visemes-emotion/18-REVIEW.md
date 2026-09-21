---
phase: 18-facial-performance-eyes-visemes-emotion
reviewed: 2026-09-21T14:22:00Z
depth: deep
files_reviewed: 16
files_reviewed_list:
  - packages/core/src/tools/emotion.ts
  - packages/core/src/tools/__tests__/emotion.test.ts
  - packages/core/src/types/audio.ts
  - packages/core/src/types/pipeline.ts
  - packages/core/src/index.ts
  - packages/providers/generic-stt-tts/src/GenericPipelineProvider.ts
  - packages/react/src/animation/eyeGaze.ts
  - packages/react/src/animation/emotion.ts
  - packages/react/src/animation/viseme.ts
  - packages/react/src/animation/gesture.ts
  - packages/react/src/animation/blink.ts
  - packages/react/src/animation/additiveBone.ts
  - packages/react/src/animation/AnimationStateEngine.ts
  - packages/react/src/animation/types.ts
  - packages/react/src/KhaveeProvider.tsx
  - packages/react/src/hooks/useRealtime.ts
  - packages/react/src/VRMAvatar.tsx
  - packages/react/src/index.ts
  - packages/react/src/hooks/useAudioLipSync.ts
findings:
  critical: 0
  warning: 5
  info: 3
  total: 8
status: issues_found
---

# Phase 18: Code Review Report

**Reviewed:** 2026-09-21T14:22:00Z
**Depth:** deep
**Files Reviewed:** 16 (animation modules, core emotion tool, provider viseme forwarding, React plumbing, VRMAvatar wiring)
**Status:** issues_found

## Summary

Phase 18 adds three animation subsystems (eye gaze with saccades, emotion crossfade driven by LLM tool-calling, and viseme lip-sync with coarticulation) to the VRM avatar. The implementation is architecturally sound: each module follows the established `create*State / step* / use*` ref-driven pattern, the emotion tool validates untrusted LLM input at the boundary with a strict allow-list, and the viseme hybrid timing-vs-analysis selection is well-reasoned. Module-scoped scratch objects are safe under JS single-threading. The GenericPipelineProvider viseme forwarding correctly guards against stale TTS events after barge-in.

No critical/blocker issues were found. Five warnings identify correctness edge cases and code quality concerns that should be addressed, and three informational items note duplication, debug artifacts, and non-null assertion usage.

Security posture of the `createEmotionTool` boundary is strong: case-sensitive allow-list, finite-number clamping, no prototype pollution risk, and never-throw contract are all tested and verified.

## Warnings

### WR-01: Dual `performance.now()` reads create a one-frame ownership disagreement between expression lerp and viseme step

**File:** `packages/react/src/VRMAvatar.tsx:764,777`
**Issue:** `visemeOwnsMouth` is evaluated from `visemeChannel.isActive(performance.now())` at line 764, then `controller.update(delta)` at line 777 calls `stepViseme` which reads `performance.now()` again via `getNowMs`. Between these two reads, the expression lerp loop runs (lines 767-772). The channel could cross the `CHANNEL_ACTIVE_WINDOW_MS` boundary between the two reads, causing the expression lerp to write viseme keys (aa/ih/ou/ee/oh) that the viseme step then immediately overwrites (last-writer-wins). In the reverse direction, the lerp could skip viseme keys that the viseme step then decides not to write (because its own `owning` check yields false on its later timestamp). This would leave the viseme expressions at whatever stale value the expression manager held from a previous frame. In practice, the two reads are microseconds apart and visible artifacts are extremely unlikely, but the invariant is formally broken.
**Fix:** Sample `performance.now()` once per frame and pass it to both call sites:
```ts
// Inside useFrame:
const nowMs = performance.now();
const visemeOwnsMouth = visemeChannel.isActive(nowMs);
// ... expression lerp ...
controller.update(delta, nowMs); // thread nowMs through to stepViseme via getNowMs override
```

### WR-02: Redundant easeInOutCubic computation in emotion "out" phase

**File:** `packages/react/src/animation/emotion.ts:317,341`
**Issue:** During the "out" phase, `easeInOutCubic(Math.min(1, state.elapsed / EMOTION_FADE_OUT_S))` is computed identically twice per frame: once inside the `else if (state.phase === "out")` interpolation block (line 317) and again inside the post-write finalize block (line 341). The first `t` is scoped inside the interpolation block and inaccessible to the finalize block. Since `easeInOutCubic` is pure, correctness is not affected, but the duplication means the cubic function runs twice per frame for the entire fade-out duration with no benefit.
**Fix:** Hoist the easeInOutCubic result for the "out" phase to a variable accessible by both blocks:
```ts
let outT: number | undefined;

// In the "out" interpolation block:
} else if (state.phase === "out") {
  state.elapsed += delta;
  outT = easeInOutCubic(Math.min(1, state.elapsed / EMOTION_FADE_OUT_S));
  // ... use outT ...
}

// In the finalize block:
if (state.phase === "out" && outT !== undefined && outT >= 1) {
  state.current = {};
  state.phase = "idle";
  // ...
}
```

### WR-03: `VisemeChannel.pushTimed` accepts timestamps on any clock without validation

**File:** `packages/react/src/animation/viseme.ts:172-173`
**Issue:** `pushTimed` rejects only `!Number.isFinite(timestamp)`. A TTS adapter that uses `Date.now()` (epoch ms, ~1.7 trillion) instead of the documented `performance.now()` convention would produce finite timestamps that are accepted and stored. However, `hasTimingAt` and `sampleTimeline` compare these against `performance.now()`-scale values (typically < 1 million ms), so the timed phonemes would never match the current time window and silently fall through to the analysis fallback or silence. This is a silent failure mode with no error, warning, or log.
**Fix:** Add a plausibility guard that rejects timestamps more than, say, 1 hour (3,600,000 ms) in the past or future relative to the current `performance.now()`:
```ts
pushTimed(phoneme: TimedPhoneme): void {
  if (!Number.isFinite(phoneme.timestamp)) return;
  const now = performance.now();
  if (Math.abs(phoneme.timestamp - now) > 3_600_000) return; // wrong clock
  // ...
}
```

### WR-04: Emotion `state.current` accumulates expression keys across emotion transitions without intermediate cleanup

**File:** `packages/react/src/animation/emotion.ts:266,289-293`
**Issue:** When a new emotion is consumed during an active hold or fade, `state.from = { ...state.current }` captures ALL keys from the previous emotion's expression map. `unionKeys(state.from, state.target)` then iterates over keys from both the old and new emotions. For example, transitioning directly from "happy" (keys: `{happy}`) to "thinking" (keys: `{relaxed, sad}`) means `state.current` carries keys `{happy, relaxed, sad}` -- the "happy" key fades to 0 but continues to be written to the expression manager via `setValue(key, 0)` on every frame through the entire `in -> hold -> out` cycle of the new emotion (potentially 20+ seconds at `EMOTION_MAX_HOLD_S`). This writes zero to an expression that is already zero, wasting a `setValue` call per extra key per frame.
**Fix:** After the crossfade interpolation loop completes (`t >= 1` in the "in" block), prune `state.current` and `state.from` of keys whose value is effectively zero:
```ts
if (t >= 1) {
  state.phase = "hold";
  // Prune zero-valued keys left over from the previous emotion
  for (const key of Object.keys(state.current)) {
    if (state.current[key] < 1e-6) delete state.current[key];
  }
  state.from = { ...state.current };
}
```

### WR-05: `useRealtime` effect's `onAudioData` handler captures stale `startAutoLipSync` closure

**File:** `packages/react/src/hooks/useRealtime.ts:143-153,196`
**Issue:** The main `useEffect` (line 71) has dependency array `[realtimeProvider, visemeChannel]`. The `onAudioData` handler at line 143 calls `startAutoLipSync()` (line 151), but `startAutoLipSync` is a `useCallback` whose identity changes when its own deps change (line 351: `[realtimeProvider, flushPendingLipSyncUpdate, visemeChannel]`). Since `startAutoLipSync` is NOT in the main effect's dependency array, the handler captures the initial closure, which itself captures the initial `lipSyncAnalyzer` value (null). If `onAudioData` fires a second time (e.g., a new TTS utterance after the first analyzer was already created), the stale closure's `if (lipSyncAnalyzer)` check at line 304 sees null and creates a duplicate analyzer. Phase 18's `visemeChannel.pushAnalysis` call inside the analyzer's callback means BOTH duplicate analyzers would push to the same channel, doubling the analysis event rate. This is a pre-existing stale-closure issue (predates Phase 18) but Phase 18's viseme channel wiring makes the consequence more visible.
**Fix:** Either add `startAutoLipSync` to the effect's dependency array (accepting the re-subscription cost), or move the analyzer creation into a ref-based pattern that avoids the stale closure.

## Info

### IN-01: Duplicated EMOTION_NAMES tuple across packages

**File:** `packages/core/src/tools/emotion.ts:32-39`, `packages/react/src/animation/emotion.ts:44-51`
**Issue:** The 6-element emotion names tuple is defined identically in both packages. The react module's header explains this is intentional (packaging note: react resolves core from published npm 0.1.5, not the workspace build). However, a future edit to one copy without updating the other would silently break the allow-list. For example, adding a seventh emotion to core but not react would mean the LLM can request an emotion the avatar ignores.
**Fix:** Add a CI assertion (e.g., in a shared test file or a build script) that compares the two arrays at build time, or re-export the core tuple from the react package once core is republished at the matching version.

### IN-02: Debug `console.log` in production hook

**File:** `packages/react/src/hooks/useRealtime.ts:305`
**Issue:** `console.log("Lip sync analyzer already running")` is a pre-existing debug artifact in a production-facing hook. Per CLAUDE.md conventions, production packages should use `console.warn` for non-fatal conditions or omit the log entirely (reserve `console.log` for mock/demo code).
**Fix:** Remove the log or downgrade to `console.warn` if the information is useful for debugging.

### IN-03: Non-null assertion on potentially null mixer ref

**File:** `packages/react/src/VRMAvatar.tsx:693`
**Issue:** `getMixer: () => mixerRef.current!` uses the `!` non-null assertion operator. In practice, the `useFrame` early return at line 753 (`if (!currentVrm?.expressionManager) return`) ensures the mixer exists before `getMixer()` is called. However, the assertion masks a potential null dereference if the guard conditions change in a future refactor. The `AvatarFormatAdapter.getMixer()` contract returns `AnimationMixer` (non-nullable), so the assertion is structurally required by the interface.
**Fix:** Either add a runtime null check with a thrown error (`const m = mixerRef.current; if (!m) throw new Error("mixer not initialized"); return m;`) or document the guard dependency with a comment linking to the `useFrame` gate.

---

_Reviewed: 2026-09-21T14:22:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
