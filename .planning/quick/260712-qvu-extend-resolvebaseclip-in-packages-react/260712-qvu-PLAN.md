---
quick_id: 260712-qvu
type: quick
files_modified:
  - packages/react/src/animation/AnimationStateEngine.ts
  - packages/react/src/animation/AnimationStateEngine.test.ts
autonomous: true
---

<objective>
Extend `resolveBaseClip()` in `packages/react/src/animation/AnimationStateEngine.ts` so `listening`, `thinking`, `starting`, and `stopped` chatStatus values each prefer a naming-convention-matched clip when one exists in `availableNames` — mirroring the existing `speaking` -> `/talk|gesture|speak/i` behavior instead of always falling through to `currentAnimation`/first-available. This is a reusable SDK-level change consumed by both `VRMAvatar` and `GLBAvatar` (ANIM-01's shared module), not a per-demo hack.

Purpose: User asked to distinguish welcome/idle/listening/talking/stopping states visually. Today only `speaking` auto-resolves to a matching clip; every other status is a no-op pass-through. This closes that gap using the same, already-established pattern-matching mechanism, so any future clip set with conventionally-named clips (e.g. a file named `listening_loop.fbx` -> clip name containing "listen") wires up automatically with zero further code changes — exactly how `speaking` already works today.
Output: `resolveBaseClip` resolves 5 status-specific patterns instead of 1; `ready` remains pattern-free (always falls through) since it has no obvious single naming convention and this preserves its current, already-tested "acts as the default idle state" behavior.
</objective>

<context>
Current implementation (confirmed by direct read, `packages/react/src/animation/AnimationStateEngine.ts:35-45`):
```ts
export function resolveBaseClip(chatStatus, currentAnimation, availableNames) {
  if (chatStatus === "speaking") {
    const talkClip = availableNames.find((name) => /talk|gesture|speak/i.test(name));
    if (talkClip) return talkClip;
  }
  return currentAnimation ?? availableNames[0] ?? null;
}
```

`ChatStatus` (`packages/core/src/types/conversation.ts:17-24`): `'ready' | 'speaking' | 'listening' | 'thinking' | 'stopped' | 'starting'`.

**Backward-compatibility check (verified by re-running the existing test suite's semantics mentally against the new design):** every existing test in `AnimationStateEngine.test.ts` still passes unmodified with the new pattern table below — none of the current test fixtures' `availableNames` arrays contain a clip matching the new `listening`/`thinking`/`stopped` patterns (so those tests still hit the same fallback path as today), and the one fixture that WOULD match a new pattern (`starting` test: `currentAnimation="greet"`, `availableNames=["idle","greet"]`, new `starting` pattern `/welcome|greet|hello|intro/i` matches `"greet"`) resolves to the identical value (`"greet"`) either way, since `currentAnimation` already equals the matching clip. Do not weaken this check when implementing — if any existing test's expected value would change, that's a signal the new patterns are miscalibrated; adjust the regex, not the test.

This mirrors `useAnimationController`'s call site (`AnimationStateEngine.ts:90`) unchanged — no changes needed there, since it just calls `resolveBaseClip(chatStatus, currentAnimation, availableNames)` as before.

**Scope boundary:** This does NOT create new visual behavior on the `openai-avatar-test` demo page today — no bundled clip in this repo has a name matching the new `listening`/`thinking`/`starting`/`stopped` patterns (only `Idle.fbx`/`talking.fbx`/`talking1.fbx`/`Fist Fight B.fbx` exist). This task only makes the resolution mechanism correct and extensible; sourcing/naming new clips is separate, out-of-scope follow-up work the user was already told about.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add a per-status clip-name pattern table to resolveBaseClip and cover it with unit tests</name>
  <files>
    packages/react/src/animation/AnimationStateEngine.ts
    packages/react/src/animation/AnimationStateEngine.test.ts
  </files>
  <read_first>
    - packages/react/src/animation/AnimationStateEngine.ts (full file — resolveBaseClip at lines 35-45, its docblock at lines 24-33, and useAnimationController's single call site at line 90)
    - packages/react/src/animation/AnimationStateEngine.test.ts (full file — existing test conventions and fixtures to preserve)
    - packages/core/src/types/conversation.ts:17-24 (ChatStatus union — confirm all 6 values before writing the pattern table)
  </read_first>
  <action>
    In `packages/react/src/animation/AnimationStateEngine.ts`:
    1. Above `resolveBaseClip`, add a module-scope `const STATUS_CLIP_PATTERNS: Partial<Record<ChatStatus, RegExp>>` mapping:
       - `speaking: /talk|gesture|speak/i` (moved from the inline `if`, behavior unchanged)
       - `listening: /listen/i`
       - `thinking: /think/i`
       - `starting: /welcome|greet|hello|intro/i`
       - `stopped: /stop|bye|goodbye|outro/i`
       (`ready` intentionally omitted — no pattern, always falls through, same as today.)
    2. Rewrite `resolveBaseClip`'s body to look up `STATUS_CLIP_PATTERNS[chatStatus]`; if a pattern exists, `availableNames.find(name => pattern.test(name))` and return the match if found; otherwise (no pattern for this status, or no matching clip name) fall through to the existing `currentAnimation ?? availableNames[0] ?? null`.
    3. Update the docblock above `resolveBaseClip` (currently describing only the `speaking` special-case) to describe the generalized per-status pattern-matching mechanism, and note that clip sets with conventionally-named files (e.g. containing "listen", "think", "welcome"/"greet", "stop"/"bye") now auto-wire for those states with zero further code changes — same mechanism `speaking` already used, now shared across 5 statuses. Keep the existing note that Phase 11 (TRANS-01/02, TALK-01/02) still owns richer per-state systems (loop-boundary-driven cycling, minimum-duration enforcement, multi-variant talk clips) — this task only adds naming-convention resolution, not those richer systems.
    In `packages/react/src/animation/AnimationStateEngine.test.ts`:
    4. Add new `describe`/`it` blocks (or extend the existing flat `it` list, matching current file style) covering: `listening` prefers a `listen`-named clip when present, falls back to `currentAnimation` when absent; `thinking` prefers a `think`-named clip when present, falls back when absent; `starting` prefers a `welcome`/`greet`-named clip when present; `stopped` prefers a `stop`/`bye`-named clip when present, falls back when absent. Use distinct clip-name fixtures per test (e.g. `"listen_loop"`, `"think_pose"`, `"welcome_wave"`, `"goodbye_wave"`) so each test is unambiguous about which pattern matched.
    5. Do NOT modify any of the 9 existing test cases — they must all still pass unmodified (this is the backward-compatibility contract described in `<context>` above).
  </action>
  <verify>
    <automated>cd /Users/whitemalt/Documents/khavee-sdk/packages/react && ./node_modules/.bin/vitest run 2>&1 | tail -20 && ./node_modules/.bin/tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `STATUS_CLIP_PATTERNS` covers `speaking`, `listening`, `thinking`, `starting`, `stopped` (not `ready`)
    - `resolveBaseClip` uses the pattern table instead of a single hardcoded `if (chatStatus === "speaking")` check
    - All 9 pre-existing tests in `AnimationStateEngine.test.ts` still pass, unmodified
    - New tests added for `listening`, `thinking`, `starting`, `stopped` pattern-match-found and pattern-match-absent-fallback cases
    - `pnpm --filter @khaveeai/react test` (or the local vitest binary) passes with 0 failures
    - `pnpm --filter @khaveeai/react exec tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>resolveBaseClip resolves listening/thinking/starting/stopped to a naming-convention-matched clip when one exists in availableNames, exactly mirroring how speaking already worked — any future clip set with conventionally-named files wires up automatically, with full unit test coverage and zero regressions to existing behavior.</done>
</task>

</tasks>

<verification>
- `pnpm --filter @khaveeai/react test` passes (all existing + new tests)
- `pnpm --filter @khaveeai/react exec tsc --noEmit` passes
- No behavioral change to any of the 9 pre-existing test cases' expected outputs
</verification>

<success_criteria>
- The shared animation module's clip-resolution mechanism now supports 5 status-specific naming conventions instead of 1, ready for future clip sets without further code changes
- Full unit test coverage for the new behavior, zero regressions
</success_criteria>

<output>
Create `.planning/quick/260712-qvu-extend-resolvebaseclip-in-packages-react/260712-qvu-SUMMARY.md` when done
</output>
