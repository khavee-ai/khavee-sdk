# Phase 12 Plan 06: Verification

Phase 12 (Gaze & Gesture) verification against its four requirements: GAZE-01, GAZE-02, GEST-01, GEST-02.

This file has two parts:
1. **Objective code-level gates (G-1..G-9)** — executed and recorded below (Task 1).
2. **Human per-state verdicts + requirement sign-off** — to be recorded after the Task 2 checkpoint resolves (not yet completed as of this writing).

---

## Part 1: Objective Gates (Task 1)

Executed 2026-07-18 against the main working tree (branch `gsd/phase-10-shared-animation-architecture-crossfade-engine`, HEAD at the completion of 12-05).

### G-1 — No absolute overwrite (`.lookAt(`)

**Command:**
```bash
grep -rc "\.lookAt(" packages/react/src/animation/gaze.ts packages/react/src/animation/gesture.ts
```

**Output:**
```
packages/react/src/animation/gesture.ts:0
packages/react/src/animation/gaze.ts:0
```

**Verdict: PASS** — 0 occurrences in both files. `gaze.ts`'s header comments deliberately avoid even the literal dotted-call substring when describing the forbidden API (documented in 12-02-SUMMARY.md's "Issues Encountered" as a prior self-referential false-positive fix).

---

### G-2 — Additive composition (PERF-01)

**Commands:**
```bash
grep -n "\.multiply(" packages/react/src/animation/gaze.ts packages/react/src/animation/gesture.ts
grep -n "quaternion\.set(\|quaternion =" packages/react/src/animation/gaze.ts packages/react/src/animation/gesture.ts
```

**Output (`.multiply(` real call sites, doc-comment mentions excluded):**
```
packages/react/src/animation/gaze.ts:226:    _scratchLocalTarget.copy(_scratchCurrent).multiply(AVERSION_OFFSET);
packages/react/src/animation/gaze.ts:252:      .multiply(_scratchWorldTarget);
packages/react/src/animation/gaze.ts:274:  _scratchDelta.copy(_scratchCurrent).invert().multiply(_scratchEasedTarget);
packages/react/src/animation/gaze.ts:279:  head.quaternion.multiply(_scratchDelta);
packages/react/src/animation/gesture.ts:150:  head.quaternion.multiply(_scratchGesture);
```

**Output (`.set(`/direct-assignment overwrite search — empty):**
```
(no output)
```

**Verdict: PASS** — both files write the live bone quaternion exclusively via `head.quaternion.multiply(...)`; no `.set()`/direct-assignment overwrite exists on either bone's quaternion.

---

### G-3 — Starting/stopped no-op (Pitfall 5)

**Command:**
```bash
grep -n "starting\|stopped\|mode === \"none\"" packages/react/src/animation/gaze.ts
```

**Output (relevant lines):**
```
160:  // "starting" | "stopped" — Pitfall 5: full no-op, not a damped mode.
194:  // Pitfall 5: starting/stopped get NO gaze treatment at all — a plain
197:  if (mode === "none") {
198:    state.activeMode = "none";
199:    state.modeElapsed = 0;
200:    return;
201:  }
```

**Verdict: PASS** — `resolveMode()` maps `starting`/`stopped` to `"none"`, and `stepGaze` early-returns unconditionally (no bone write, no `proceduralScale`/`settleScale` involvement) when `mode === "none"`. This is a full branch-on-`chatStatus` early return, not an amplitude-scaled pass through the shared procedural-scale pipeline.

---

### G-4 — No duplicated loop-boundary math

**Commands:**
```bash
grep -n "detectLoopBoundary" packages/react/src/animation/talkCycle.ts packages/react/src/animation/gesture.ts
grep -n "currentTime < .*prevActionTime\|prevActionTime.*currentTime" packages/react/src/animation/gesture.ts packages/react/src/animation/talkCycle.ts
```

**Output:**
```
packages/react/src/animation/talkCycle.ts:89:export function detectLoopBoundary(
packages/react/src/animation/talkCycle.ts:127:  const loopBoundary = detectLoopBoundary(currentTime, state.prevActionTime, duration);
packages/react/src/animation/gesture.ts:37:import { detectLoopBoundary } from "./talkCycle";
packages/react/src/animation/gesture.ts:117:        : detectLoopBoundary(currentTime, state.prevActionTime, duration);
```
(inline-wrap-math search returned only the expected `state.prevActionTime = currentTime` bookkeeping assignment in each file — no reimplemented comparison logic.)

**Verdict: PASS** — `detectLoopBoundary` is defined exactly once (`talkCycle.ts:89`), imported by `gesture.ts:37`, and called by both `stepTalkCycle` (`talkCycle.ts:127`) and `stepGesture` (`gesture.ts:117`). No inline `currentTime < ...prevActionTime` reimplementation exists in `gesture.ts`.

---

### G-5 — Composition order preserved

**Evidence (read directly from `AnimationStateEngine.ts`):**

`update()`'s header comment (lines 938-944):
```
// PERF-01 fixed, documented composition order — every system below runs
// every frame, in this exact order:
//   1. crossfade ramp -> 2. blink -> 3. amplitude/settle scale compute
//   -> 4a. lazily capture rest-pose anchor -> 4b. reset-if-not-driven
//   -> 4c. capture spine base -> 5. breathing -> 6. sway -> 7. spine
//   clamp -> 8. expression drift -> 9. talk-cycle -> 10. gaze ->
//   11. gesture.
```

Steps 1-9's actual call sites (lines 971-1177) match this list unchanged from Phase 11's own documented order (crossfade retry → crossfade step → blink → amplitude/settle scale → rest-pose capture/reset → breathing → sway → spine clamp → expression drift → talk-cycle). Steps 10-11 are appended after talk-cycle (lines 1179-1206):
```
1190:    if (camera) gaze.step(adapter, camera, chatStatus, delta);
...
1199:    gesture.step({
1200:      adapter,
1201:      chatStatus,
1202:      gestureHint: gestureHint ?? null,
1203:      currentAction: currentActionRef.current,
1204:      delta,
1205:      onConsume: () => onGestureConsumed?.(),
1206:    });
```

**Verdict: PASS** — steps 1-9 are unreordered; gaze is appended as step 10, gesture as step 11, exactly as the plan requires.

---

### G-6 — GEST-01 packaging (`toolGesture` barrel export)

**Command:**
```bash
grep -c "toolGesture" packages/core/src/index.ts
```

**Output:**
```
1
```

**File content (`packages/core/src/index.ts`):**
```typescript
// Core SDK Types and Interfaces
export * from './types';
export * from './client/khavee-client';
export { toolGesture } from './tools/gesture';
export { toolAnimate } from './tools/animate';
```

**Verdict: PASS** — `toolGesture` is re-exported from `@khaveeai/core`'s barrel, closing the RESEARCH-flagged Pitfall 2 gap (this also drive-fixed `toolAnimate`'s equivalent long-standing gap, per 12-01's scope).

---

### G-7 — Internal-only (gaze/gesture not exported from `@khaveeai/react`)

**Command:**
```bash
grep -n "gaze\|gesture" packages/react/src/index.ts
```

**Output:**
```
(no output)
```

**Verdict: PASS** — `packages/react/src/index.ts` contains no reference to `gaze` or `gesture` — both procedural systems stay internal, matching the Phase 10/11 precedent (`breathing.ts`/`sway.ts`/`talkCycle.ts` are likewise unexported).

---

### G-8 — Frame-budget hygiene (no per-frame allocation)

**Command:**
```bash
grep -n "new THREE\.\(Quaternion\|Vector3\)" packages/react/src/animation/gaze.ts packages/react/src/animation/gesture.ts
```

**Output:**
```
packages/react/src/animation/gaze.ts:96:const _scratchCurrent = new THREE.Quaternion();
packages/react/src/animation/gaze.ts:97:const _scratchWorldTarget = new THREE.Quaternion();
packages/react/src/animation/gaze.ts:98:const _scratchParentWorldQuat = new THREE.Quaternion();
packages/react/src/animation/gaze.ts:99:const _scratchLocalTarget = new THREE.Quaternion();
packages/react/src/animation/gaze.ts:100:const _scratchClampedTarget = new THREE.Quaternion();
packages/react/src/animation/gaze.ts:101:const _scratchEasedTarget = new THREE.Quaternion();
packages/react/src/animation/gaze.ts:102:const _scratchDelta = new THREE.Quaternion();
packages/react/src/animation/gaze.ts:103:const _scratchHeadWorldPos = new THREE.Vector3();
packages/react/src/animation/gaze.ts:104:const _scratchCameraWorldPos = new THREE.Vector3();
packages/react/src/animation/gaze.ts:105:const _scratchDirection = new THREE.Vector3();
packages/react/src/animation/gaze.ts:109:const HEAD_FORWARD_AXIS = new THREE.Vector3(0, 0, -1);
packages/react/src/animation/gaze.ts:126:const AVERSION_OFFSET = new THREE.Quaternion().setFromEuler(...);
packages/react/src/animation/gesture.ts:42:const _scratchGesture = new THREE.Quaternion();
packages/react/src/animation/gesture.ts:45:const NOD_AXIS = new THREE.Vector3(1, 0, 0);
packages/react/src/animation/gesture.ts:47:const SHAKE_AXIS = new THREE.Vector3(0, 1, 0);
```

**Verdict: PASS** — every `new THREE.Quaternion()`/`new THREE.Vector3()` occurrence in both files is a module-scoped `const` declaration (lines 96-126 in `gaze.ts`, all above `stepGaze`'s definition; lines 42-47 in `gesture.ts`, all above `stepGesture`'s definition). None appear inside `stepGaze()`'s or `stepGesture()`'s per-frame function bodies — confirmed by inspecting both functions directly (read in full during this verification pass).

---

### G-9 — Suites green + tsc clean

**Commands + output:**

```bash
cd packages/react && pnpm test
```
```
 Test Files  10 passed (10)
      Tests  144 passed (144)
```
(includes `gaze.test.ts` — 14 tests, `gesture.test.ts` — 13 tests, `talkCycle.test.ts` — 16 tests including `detectLoopBoundary` cases, `AnimationStateEngine.test.ts` — 55 tests including the gaze/gesture composition-order integration block)

```bash
cd packages/core && pnpm test
```
```
 Test Files  2 passed (2)
      Tests  10 passed (10)
```
(includes `src/tools/__tests__/gesture.test.ts` — 6 tests for `toolGesture`'s shape/enum)

```bash
cd packages/react && npx tsc --noEmit
```
Exit code: `0` (no output — clean)

```bash
cd packages/core && npx tsc --noEmit
```
Exit code: `0` (no output — clean)

**Verdict: PASS** — both packages' test suites exit 0 (144/144 react, 10/10 core) and both are `tsc --noEmit` clean.

---

### Objective Gates Summary

| Gate | Description | Verdict |
|------|-------------|---------|
| G-1 | No `.lookAt(` in gaze.ts/gesture.ts | PASS |
| G-2 | Additive composition, no overwrite | PASS |
| G-3 | starting/stopped full no-op | PASS |
| G-4 | detectLoopBoundary defined once, reused | PASS |
| G-5 | Composition order 1-9 unreordered, gaze=10/gesture=11 | PASS |
| G-6 | toolGesture exported from core barrel | PASS |
| G-7 | gaze/gesture not exported from react barrel | PASS |
| G-8 | No per-frame allocation | PASS |
| G-9 | Test suites green + tsc clean (both packages) | PASS |

**All 9 objective gates PASS. No failures — the human checkpoint (Task 2) is not blocked by any objective gate.**

---

## Part 2: Human Verdicts + Requirement Sign-off (Task 2)

**Status: PENDING** — Task 2 (`checkpoint:human-verify`, gate="blocking") has not yet been executed. A human must run the dev app and verify per-state gaze (VRM + GLB) and nod/shake gesture behavior per the plan's `<how-to-verify>` steps before this section can be completed.

This section will be filled in with:
- Per-state gaze verdict (ready/listening/speaking soft gaze, thinking aversion, starting/stopped no-op) — VRM
- Per-state gaze verdict — GLB (GAZE-02 symmetry)
- Gesture verdict (immediate outside speaking, queued at loop boundary while speaking, never interrupts mid-clip) — GEST-01/02
- Regression check (Phase 11 idle behavior unaffected)
- Explicit sign-off table for GAZE-01, GAZE-02, GEST-01, GEST-02 (confirmed / gap recorded)

**Phase 12 is NOT yet fully confirmed pending this human checkpoint.**
