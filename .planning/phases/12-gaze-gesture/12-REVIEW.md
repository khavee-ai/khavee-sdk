---
phase: 12-gaze-gesture
reviewed: 2026-07-18T08:22:39Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - packages/core/src/index.ts
  - packages/core/src/tools/__tests__/gesture.test.ts
  - packages/core/src/tools/gesture.ts
  - packages/react/scripts/verify-head-axis.mjs
  - packages/react/src/GLBAvatar.tsx
  - packages/react/src/KhaveeProvider.tsx
  - packages/react/src/VRMAvatar.tsx
  - packages/react/src/animation/AnimationStateEngine.test.ts
  - packages/react/src/animation/AnimationStateEngine.ts
  - packages/react/src/animation/gaze.test.ts
  - packages/react/src/animation/gaze.ts
  - packages/react/src/animation/gesture.test.ts
  - packages/react/src/animation/gesture.ts
  - packages/react/src/animation/talkCycle.test.ts
  - packages/react/src/animation/talkCycle.ts
  - src/app/openai-avatar-test/page.tsx
findings:
  critical: 0
  warning: 2
  info: 6
  total: 8
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-07-18T08:22:39Z
**Depth:** standard
**Files Reviewed:** 15 (16 listed; `src/app/openai-avatar-test/page.tsx` reviewed as consumer wiring)
**Status:** issues_found

## Summary

Reviewed the gaze/gesture procedural-animation layer (`gaze.ts`, `gesture.ts`, `talkCycle.ts`, `AnimationStateEngine.ts`), the `set_gesture` LLM tool (`packages/core/src/tools/gesture.ts`), the `KhaveeProvider`/`VRMAvatar`/`GLBAvatar` wiring, the headless axis-verification script, and the demo page that exercises this end-to-end. The unit test coverage for the pure state-machine functions (`stepGaze`, `stepGesture`, `detectLoopBoundary`, `shouldTriggerClipSwitch`, etc.) is thorough and each function traced against its tests behaves as documented in isolation.

The two product-behavior gaps already recorded in `12-06-VERIFICATION.md` (gaze camera-offset snapping instead of interpolating; a GLB-only idle-spin regression) are treated as out of scope per the review brief. Reading `gaze.ts` end-to-end, I traced the exact mechanism for the snap and included it below as a pointer (not counted as a new finding) since it wasn't obvious from the human-verify checkpoint alone. I did not find a definitive new root cause for the GLB-only idle-spin regression within the files in scope.

Two real logic bugs were found in the composition layer (`AnimationStateEngine.ts` / `gaze.ts`) that are independent of the two already-tracked issues: the controller's `if (camera)` guard silently disables the camera-independent "thinking" aversion gaze whenever no camera is threaded through (contradicting `gaze.ts`'s own documented contract and its own unit tests), and the shared angle clamp is applied to the aversion offset despite a file-header comment claiming it isn't needed — which measurably shrinks the aversion effect below its documented constants. Neither is a crash/security issue; both are classified as Warnings. The remaining items are Info-level quality/coverage notes.

## Warnings

### WR-01: Composed controller's `if (camera)` guard suppresses camera-independent "thinking" aversion gaze

**File:** `packages/react/src/animation/AnimationStateEngine.ts:1190`
**Issue:** `update()`'s step 10 is:

```ts
if (camera) gaze.step(adapter, camera, chatStatus, delta);
```

`gaze.ts`'s own `stepGaze` explicitly supports (and is unit-tested for) a `camera: null` argument in `"thinking"` (aversion) mode — `gaze.ts`'s file header states "`thinking`'s aversion... has no camera dependency", and `gaze.test.ts`'s "produces the same delta whether a camera is supplied or not" test proves this. `AnimationStateEngine.ts`'s own JSDoc for the `camera` param even documents this precisely: "Optional — omitted/null is a full no-op for **gaze's camera mode**" (i.e., only camera mode, not aversion mode).

However, the call site guards the ENTIRE `gaze.step()` call on `camera` being truthy, so when a consumer omits/nulls `camera` (a documented-optional param), `stepGaze` is never invoked at all — including for `"thinking"` status, where it should still apply the fixed aversion offset with no camera dependency. This contradicts both the JSDoc contract and the tested behavior of `gaze.ts` in isolation. It does not currently manifest in the two shipped components (`VRMAvatar.tsx`/`GLBAvatar.tsx` both always pass a real `useThree((s) => s.camera)` value), but any consumer wiring `useAnimationController` directly without a camera (e.g. a headless/offscreen use case, or a future non-R3F integration) silently loses "thinking" aversion gaze entirely, with no error or indication.

**Fix:** Drop the outer guard and let `gaze.ts`'s own internal per-mode logic decide (it already handles `camera: null | undefined` correctly for both aversion and the no-op camera-mode case):

```ts
// 10. Gaze (GAZE-01/02) — gaze.ts itself is a full no-op for camera mode
// when no camera is supplied; do not gate the call on `camera` here or
// aversion mode (which has no camera dependency) is wrongly skipped too.
gaze.step(adapter, camera ?? null, chatStatus, delta);
```

### WR-02: Shared angle clamp silently shrinks the "thinking" aversion offset below its documented magnitude

**File:** `packages/react/src/animation/gaze.ts:222-266` (see also file header, lines 65-69)
**Issue:** The file header states: "`thinking`'s aversion (Pattern 2) skips steps 2-3 entirely... **no clamp is needed** (the offset is bounded by construction)." In fact the clamp code (lines 255-266) is NOT skipped for aversion mode — it runs unconditionally for both branches:

```ts
const targetAngle = _scratchCurrent.angleTo(_scratchLocalTarget);
if (targetAngle > MAX_GAZE_ANGLE_RAD && targetAngle > 0) {
  const t = MAX_GAZE_ANGLE_RAD / targetAngle;
  _scratchClampedTarget.copy(_scratchCurrent).slerp(_scratchLocalTarget, t);
} else {
  _scratchClampedTarget.copy(_scratchLocalTarget);
}
```

`AVERSION_OFFSET` is built from `AVERSION_PITCH_RAD = 0.02` and `AVERSION_YAW_RAD = 0.06` (lines 124-128). I verified numerically (via `THREE.Quaternion.angleTo`) that the combined rotation angle of `AVERSION_OFFSET` is **≈0.0632 rad**, which is *greater* than `MAX_GAZE_ANGLE_RAD` (0.05 rad) — so the clamp DOES engage every time aversion mode is fully ramped in, silently capping the applied rotation to 0.05 rad (≈79% of the nominal 0.0632 rad). `gaze.test.ts`'s own aversion test ("produces a bounded non-zero delta with camera=null") independently confirms this by asserting `angle <= MAX_GAZE_ANGLE_RAD + 1e-6` for aversion mode — i.e. the shipped, tested behavior already contradicts the file-header's "no clamp is needed" claim. The practical effect: the pitch/yaw ratio implied by the named constants (1:3) is preserved (slerp preserves direction), but the total magnitude is silently smaller than the constants suggest, and the file-header rationale is factually incorrect for the current values.
**Fix:** Either (a) raise `MAX_GAZE_ANGLE_RAD` or lower `AVERSION_YAW_RAD`/`AVERSION_PITCH_RAD` so the aversion offset's angle stays under the clamp threshold and update the header comment to note the shared-clamp interaction, or (b) explicitly skip the clamp for the aversion branch (matching what the comment already claims) by moving the clamp step inside the `mode === "camera"` branch only. Either way, the header comment and the code should agree.

## Info

### IN-01: Root-cause pointer for the already-tracked gaze camera-offset "snap" (out of scope, not a new finding)

**File:** `packages/react/src/animation/gaze.ts:268-274`
**Issue:** Per the review brief, the snap-instead-of-interpolate behavior is already tracked and out of scope, but the exact mechanism is worth recording here since it wasn't obvious from the human-verify checkpoint: `state.modeElapsed`/`strength` only ramps ONCE per mode-entry (over `RAMP_SECONDS` = 0.3s). Once `strength` reaches `1`, line 270 becomes `_scratchEasedTarget.copy(_scratchCurrent).slerp(_scratchClampedTarget, 1)`, which is exactly `_scratchClampedTarget` — i.e. the eased target collapses to the full target every single frame once ramped in, with no further per-frame damping toward a continuously-moving camera. Since `_scratchCurrent` is captured fresh as the head's actual current orientation each frame (line 220), the resulting additive delta (`current^-1 * easedTarget`) exactly closes the gap to the target in one frame — a hard snap to wherever the camera currently is, every frame, rather than a continuously-damped approach. This is the single line to change if/when the tracked issue is fixed (e.g. replacing the one-shot ramp with a per-frame exponential/critically-damped approach toward the target once ramped in, rather than `slerp(current, clampedTarget, strength)` where `strength` saturates at 1).

### IN-02: Possible contributing factor to gaze jitter — world-space reads are one frame stale

**File:** `packages/react/src/animation/gaze.ts:230-252`
**Issue:** `stepGaze`'s camera branch reads `head.getWorldPosition()`, `camera.getWorldPosition()`, and `head.parent.getWorldQuaternion()`. These rely on `matrixWorld`, which THREE.js (and R3F's default render loop) only recomputes during the render pass, i.e. AFTER all `useFrame` callbacks (including `controller.update()`/`gaze.step()`) have run for the current frame. Per the documented frame-ordering contract (`mixer.update -> controller.update -> vrm.update -> render`), this means gaze's camera-relative math this frame is computed against last frame's world transforms, not the transforms just written this same frame (by the mixer, breathing/sway, or the rest-pose reset). This is a one-frame lag, not a crash, but is a plausible contributing factor to the already-tracked snapping/jitter symptom, particularly right after a crossfade or a fast camera orbit. Not filing as a standalone bug since it's likely secondary to WR/IN-01 above, but noting the exact reads for whoever picks up the tracked gaze-smoothing issue.

### IN-03: `gesture.ts`'s independently-tracked `prevActionTime` can read one spurious loop-boundary on a talk-cycle switch frame

**File:** `packages/react/src/animation/gesture.ts:100-131`, interacting with `packages/react/src/animation/AnimationStateEngine.ts:1160-1177` (talk-cycle step 9 runs before gesture step 11)
**Issue:** `gesture.ts` deliberately tracks its own `prevActionTime` separately from `talkCycle.ts`'s (per the file header, "each consumer of `detectLoopBoundary` owns its own previous-time sample"). On the exact frame `talkCycle.step` (step 9) switches `currentActionRef.current` to a new variant, `gesture.step` (step 11, same frame) reads the NEW action's `.time` (≈0, freshly reset) against gesture's own stale `prevActionTime` (sampled from the OLD action, typically near its `duration`). `detectLoopBoundary`'s wrap check (`currentTime < prevTime`) then reads `true` on that frame purely as an artifact of the action reference changing underneath it, not because the new clip actually looped. `talkCycle.ts`'s own analogous read is protected by its `MIN_TALK_DWELL_SECONDS` floor (a spurious same-frame reading can't retrigger another switch within one frame's `delta`), but `gesture.ts` has no equivalent cooldown — a gesture queued during `speaking` can begin exactly on a talk-cycle switch frame rather than waiting for the currently-playing variant's own next loop boundary. In practice this coincides with a genuine boundary of the OLD clip (that's what triggered the switch), so it's likely benign/imperceptible, but it is a real deviation from the documented "queued until the ambient talk-cycle's currently-playing action crosses its next natural loop boundary" contract. Worth a comment or a shared-cooldown guard if gesture timing is ever audited closely.

### IN-04: `setGestureHint` typed as `string | null` instead of the narrower `GestureHint`-shaped union

**File:** `packages/react/src/KhaveeProvider.tsx:30, 306-312`
**Issue:** `KhaveeContextType.setGestureHint` is `(gesture: string | null) => void`, wider than the `"nod" | "shake" | "none" | null` union (`GestureHint`) the rest of this feature uses (`gesture.ts`). Every caller in this diff (`src/app/openai-avatar-test/page.tsx`'s manual Nod/Shake buttons, the tool's `execute` callback) happens to pass a valid literal, but the loose parameter type means a typo like `setGestureHint('nodd')` or `setGestureHint('Nod')` compiles without error and silently normalizes to `null` inside the function body — no compiler feedback for library consumers who call this directly, which cuts against the "beginner DX" goal called out in this project's constraints.
**Fix:** Narrow the signature to `(gesture: "nod" | "shake" | "none" | string | null) => void` (still permissive for arbitrary LLM tool-call strings) or at minimum export/reuse `GestureHint`'s literal members in the public type so IDEs autocomplete the three valid values while still accepting arbitrary runtime input defensively.

### IN-05: Redundant condition in `gaze.ts`'s clamp check

**File:** `packages/react/src/animation/gaze.ts:261`
**Issue:** `if (targetAngle > MAX_GAZE_ANGLE_RAD && targetAngle > 0)` — the second clause is always true whenever the first is true, since `MAX_GAZE_ANGLE_RAD` (0.05) is itself positive. Harmless but slightly misleading (reads as if there's a distinct zero-angle guard).
**Fix:** Simplify to `if (targetAngle > MAX_GAZE_ANGLE_RAD)`.

### IN-06: 12-04 integration tests never exercise `chatStatus: "thinking"` or an omitted camera through the composed controller

**File:** `packages/react/src/animation/AnimationStateEngine.test.ts:948-1040`
**Issue:** The new "useAnimationController — gaze/gesture integration (12-04)" describe block covers `"ready"`/`"listening"` with a camera supplied, and a no-camera/no-gesture smoke test, but never calls `controller.update()` with `chatStatus: "thinking"` (aversion mode), nor with `chatStatus: "thinking"` and `camera` omitted/null — exactly the combination that would have caught WR-01 above at the composed-controller level (the `gaze.test.ts` unit tests do cover it at the `stepGaze` level, but nothing exercises the composition in `AnimationStateEngine.ts` where the bug actually lives).
**Fix:** Add a test asserting that with `chatStatus: "thinking"`, `camera` omitted, and a resolvable head bone, the head bone's quaternion changes from identity after `controller.update()` — this would currently fail against WR-01 and guard the fix.

---

_Reviewed: 2026-07-18T08:22:39Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
