---
phase: quick-260918-gzb
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/react/src/animation/talkCycle.ts
  - packages/react/src/animation/talkCycle.test.ts
  - packages/react/src/animation/AnimationStateEngine.ts
  - packages/react/src/animation/AnimationStateEngine.test.ts
  - packages/react/src/animation/animationConfig.ts
  - packages/react/src/animation/animationConfig.test.ts
  - packages/react/src/VRMAvatar.tsx
  - packages/react/src/GLBAvatar.tsx
  - packages/react/src/index.ts
  - apps/playground/src/app/animation-test/page.tsx
autonomous: true
requirements: [QUICK-260918-gzb]

must_haves:
  truths:
    - "While ready, listening, thinking, or speaking, if 2+ loaded clips match that status's pattern, the avatar crossfades to another matching clip at a loop boundary once the minimum dwell has passed"
    - "starting and stopped never cycle (they stay one-shot transitions)"
    - "animationCycleOrder='random' (default) never picks the same clip twice in a row and picks a random matching clip when entering a status; 'sequential' keeps round-robin and first-match entry"
    - "animationMinDwellSeconds (default 2) sets the minimum time a clip plays before the cycle can swap it"
    - "AnimationConfig accepts string | string[] per key; arrays load as clips named `${key}_0`, `${key}_1`, ..."
    - "Gesture queuing on the speaking loop boundary still works (gesture.ts untouched, update() step order unchanged)"
  artifacts:
    - path: "packages/react/src/animation/talkCycle.ts"
      provides: "Generic status clip cycler (stepClipCycle/useClipCycle, pickRandomVariantIndex, CYCLING_STATUSES, AnimationCycleOrder) plus the unchanged detectLoopBoundary"
      exports: ["stepClipCycle", "useClipCycle", "createClipCycleState", "nextVariantIndex", "pickRandomVariantIndex", "detectLoopBoundary", "CYCLING_STATUSES", "MIN_TALK_DWELL_SECONDS", "AnimationCycleOrder"]
    - path: "packages/react/src/animation/animationConfig.ts"
      provides: "Pure expandAnimationConfig flattening string | string[] entries"
      exports: ["expandAnimationConfig", "AnimationConfig"]
    - path: "packages/react/src/animation/AnimationStateEngine.ts"
      provides: "resolveBaseClip with order/rng options, generalized shouldTriggerClipSwitch guard, controller cycleOrder/minDwellSeconds params"
  key_links:
    - from: "packages/react/src/VRMAvatar.tsx"
      to: "useAnimationController"
      via: "cycleOrder: animationCycleOrder, minDwellSeconds: animationMinDwellSeconds"
      pattern: "cycleOrder:\\s*animationCycleOrder"
    - from: "packages/react/src/GLBAvatar.tsx"
      to: "useAnimationController"
      via: "cycleOrder: animationCycleOrder, minDwellSeconds: animationMinDwellSeconds"
      pattern: "cycleOrder:\\s*animationCycleOrder"
    - from: "packages/react/src/animation/AnimationStateEngine.ts"
      to: "stepClipCycle"
      via: "update() step 9"
      pattern: "clipCycle\\.step"
---

<objective>
Generalize the speaking-only talk-variant cycler into a status clip cycler covering ready, listening, thinking and speaking. Add two flat props on VRMAvatar and GLBAvatar: cycle order ("random" | "sequential") and minimum dwell. Also let AnimationConfig take a list of URLs per key.

Purpose: Avatars with several idle, listen, think or talk clips rotate through them naturally instead of looping only the first match.
Output: A generalized talkCycle.ts, a new animationConfig.ts helper, engine and avatar wiring, and vitest coverage.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@packages/react/src/animation/talkCycle.ts
@packages/react/src/animation/talkCycle.test.ts

Targeted reads only (large files — use offsets):
- packages/react/src/animation/AnimationStateEngine.ts: L420-430 (imports), L661-678 (STATUS_CLIP_PATTERNS), L696-767 (resolveBaseClip + shouldTriggerClipSwitch), L825-1030 (useAnimationController params, refs, targetName, switchToClip, effect), L1040-1080 (update step 0), L1265-1316 (step 9 talk-cycle, step 10 gaze, step 11 gesture)
- packages/react/src/animation/AnimationStateEngine.test.ts: L25-40 (imports), L63-167 (resolveBaseClip tests), L480-566 (shouldTriggerClipSwitch tests)
- packages/react/src/VRMAvatar.tsx: L121-140 (props), L170-233 (AnimationConfig + useAnimationFiles), L240-360 (JSDoc + destructure), L560-580 (controller call)
- packages/react/src/GLBAvatar.tsx: L17-40 (props), L115-130 (destructure), L225-245 (controller call)

<interfaces>
Current (talkCycle.ts, internal and NOT exported from index.ts):
- MIN_TALK_DWELL_SECONDS = 2.0
- interface TalkCycleState { dwellSeconds: number; prevActionTime: number | null }
- createTalkCycleState(): TalkCycleState
- interface TalkCycleStepParams { chatStatus; currentAction: THREE.AnimationAction | null; currentClipName: string | null; speakingVariants: string[]; delta: number }
- nextVariantIndex(currentIndex: number, length: number): number
- detectLoopBoundary(currentTime, prevTime, duration): boolean   (ALSO imported by gesture.ts; keep the signature and export)
- stepTalkCycle(state, params): string | null
- useTalkCycle(): { step(params): string | null }

Current (AnimationStateEngine.ts):
- const STATUS_CLIP_PATTERNS: Partial<Record<ChatStatus, RegExp>> (module-private)
- export function resolveBaseClip(chatStatus, currentAnimation: string | null, availableNames: string[]): string | null
- export function shouldTriggerClipSwitch(params: { targetName; chatStatus; currentClipName; canResolveAction: boolean; canResolveRoot: boolean }): boolean   (speaking-only variant-ownership guard today)
- export function useAnimationController(params: {..., onGestureConsumed?}): { update(delta): void }
  - `const targetName = resolveBaseClip(...)` is computed every render (L926)
  - update() step 9 filters availableNames by STATUS_CLIP_PATTERNS.speaking and calls talkCycle.step

Current (VRMAvatar.tsx): `export interface AnimationConfig { [name: string]: string }`; useAnimationFiles iterates Object.entries(animationUrls) calling useFBX/useGLTF per entry, and memoizes on JSON.stringify(animationUrls). processedClips sets clip.name = config key.
index.ts: `export type { AnimationConfig } from "./VRMAvatar";`
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Generalize talkCycle.ts into a status clip cycler with order, dwell, and injectable rng</name>
  <files>packages/react/src/animation/talkCycle.ts, packages/react/src/animation/talkCycle.test.ts</files>
  <behavior>
    - pickRandomVariantIndex(currentIndex, length, rng): length 0 returns 0; length 1 returns 0; with length >= 2 and currentIndex valid, never returns currentIndex for rng values 0, 0.5, 0.999999 and 1 (clamp); with currentIndex -1, returns floor(rng()*length) clamped to length-1
    - stepClipCycle cycles for "ready", "listening", "thinking" and "speaking" (same prime frame, then wrap-after-dwell pattern as the existing tests), and returns null plus resets state for "starting" and "stopped"
    - A chatStatus change between two cycling statuses (e.g. listening to thinking) resets dwell and prevActionTime, so the first frame after the change can never switch
    - order "sequential" gives today's round-robin (the existing 3-variant a to b to c to a test still passes); order "random" with a stub rng returns the rng-chosen index and never the current clip
    - minDwellSeconds overrides the floor: with minDwellSeconds 0.5, a boundary at 0.6s dwell switches; with the default, it does not
    - The existing detectLoopBoundary and nextVariantIndex tests stay unchanged and pass
  </behavior>
  <action>
Write the tests first (RED), then implement (GREEN).

In talkCycle.ts (keep the filename so gesture.ts's `import { detectLoopBoundary } from "./talkCycle"` is untouched, per locked decision 7):
- Add `export type AnimationCycleOrder = "random" | "sequential";`
- Add `export const CYCLING_STATUSES: readonly ChatStatus[] = ["ready", "listening", "thinking", "speaking"];` per decision 1. starting and stopped are excluded because they are one-shot transitions.
- Keep `MIN_TALK_DWELL_SECONDS = 2.0`. Update its JSDoc: it is the default for the `animationMinDwellSeconds` prop (decision 4) and applies to every cycling status.
- Add `export function pickRandomVariantIndex(currentIndex: number, length: number, rng: () => number = Math.random): number`. For length >= 2 with a valid currentIndex, draw from length-1 slots: `idx = Math.min(Math.floor(rng() * (length - 1)), length - 2)`. If `idx >= currentIndex`, add 1. This never repeats the current clip (decision 2) and needs no retry loop. With currentIndex < 0, return `Math.min(Math.floor(rng() * length), length - 1)`. For length <= 1, return 0.
- Rename TalkCycleState, createTalkCycleState, TalkCycleStepParams, stepTalkCycle and useTalkCycle to ClipCycleState, createClipCycleState, ClipCycleStepParams, stepClipCycle and useClipCycle. Do not keep the old aliases; the module is internal and not exported from index.ts. ClipCycleState gains `lastStatus: ChatStatus | null`, initially null.
- ClipCycleStepParams: rename `speakingVariants` to `variants` (the clips matching the CURRENT status's pattern, filtered by the caller). Add optional `order?: AnimationCycleOrder` (the pure helper defaults to "sequential", which keeps the legacy round-robin; the public prop default "random" is applied in useAnimationController). Add optional `minDwellSeconds?: number` (default MIN_TALK_DWELL_SECONDS) and optional `rng?: () => number` (default Math.random, per decision 8).
- stepClipCycle logic:
  1. If the status is not in CYCLING_STATUSES, reset dwell, prevActionTime and lastStatus, then return null.
  2. If `chatStatus !== state.lastStatus`, reset dwell and prevActionTime and set lastStatus. This covers cycling-to-cycling transitions such as listening to thinking.
  3. If fewer than 2 variants, return null.
  4. Otherwise run the existing dwell-plus-detectLoopBoundary logic against minDwellSeconds.
  5. At a boundary, choose the next index with nextVariantIndex (sequential) or pickRandomVariantIndex (random), reset dwell, and return the chosen name.
- Rewrite the file-header comment to describe the generalized scope (it was TALK-01 speaking-only; the status cycler now covers ready/listening/thinking/speaking). Keep the timer-free rationale paragraph. Use the repo's JSDoc style on every new export.

In talkCycle.test.ts: rename the call sites to stepClipCycle/createClipCycleState/`variants`. Any existing test that used a non-speaking status ("ready"/"listening"/"thinking") to assert "resets / returns null outside speaking" must switch to "starting" or "stopped", since those statuses now cycle. Add the behavior tests listed above. Use a deterministic stub rng (e.g. `() => 0.99`), never Math.random.
  </action>
  <verify>
    <automated>cd /Users/whitemalt/Documents/khavee-sdk/packages/react && npx vitest run src/animation/talkCycle.test.ts src/animation/gesture.test.ts</automated>
  </verify>
  <done>talkCycle and gesture tests pass. stepClipCycle cycles all four statuses in both orders with the configurable dwell. gesture.ts is unmodified.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Engine wiring — random entry in resolveBaseClip, generalized ownership guard, controller cycleOrder/minDwellSeconds</name>
  <files>packages/react/src/animation/AnimationStateEngine.ts, packages/react/src/animation/AnimationStateEngine.test.ts</files>
  <behavior>
    - resolveBaseClip with no 4th argument behaves exactly as today, so all existing resolveBaseClip tests pass untouched
    - resolveBaseClip("ready", null, ["idle_0","idle_1","idle_2"], { order: "random", rng: () => 0.5 }) returns "idle_1"; the same call with order "sequential" returns "idle_0"
    - resolveBaseClip for "starting"/"stopped" with order "random" still returns the first match
    - shouldTriggerClipSwitch returns false for (ready, target "idle_0", current "idle_2"), (listening, target "listen_0", current "listen_1") and (thinking, target "think_a", current "think_b")
    - shouldTriggerClipSwitch returns true for listening with current "idle_0" (the entry switch), and for starting with current "welcome_b" and target "welcome_a" (starting is not a cycling status, so the guard does not apply)
    - The existing speaking-guard tests (L543-566) still pass
  </behavior>
  <action>
Write tests first, then implement. Do not reorder update()'s numbered steps; gesture step 11 relies on running after the cycle switch (decision 7).

1. Import CYCLING_STATUSES, MIN_TALK_DWELL_SECONDS, useClipCycle and `type AnimationCycleOrder` from "./talkCycle". Also `export type { AnimationCycleOrder } from "./talkCycle";` so the avatars and index.ts can import it from the engine.

2. resolveBaseClip: add an optional 4th param `options?: { order?: AnimationCycleOrder; rng?: () => number }`. Collect every name matching the pattern. If `options?.order === "random"`, the status is in CYCLING_STATUSES, and there are 2+ matches, return `matches[pickRandomVariantIndex(-1, matches.length, options.rng ?? Math.random)]` (import pickRandomVariantIndex). Otherwise return the first match, then the existing fallbacks. This implements decision 2's "random entry; sequential keeps first-match". Update the JSDoc, since the "Phase 11 still owns ... cycling" paragraph is now stale.

3. shouldTriggerClipSwitch (decision 6): replace the `chatStatus === "speaking"` guard with: the status is in CYCLING_STATUSES, `STATUS_CLIP_PATTERNS[chatStatus]` exists, `currentClipName !== null`, and the pattern matches currentClipName. In that case return false. Keep the function pure and exported. Update its JSDoc to describe cycling-status ownership: the clip cycler inside update() is the sole owner of which variant shows while in any cycling status.

4. useAnimationController params: add two JSDoc'd params.
   - `cycleOrder?: AnimationCycleOrder`, default "random" (decision 2).
   - `minDwellSeconds?: number`, default MIN_TALK_DWELL_SECONDS (decision 4). Sanitize it: if it is non-finite or < 0, use the default.
   Replace `useTalkCycle()` with `useClipCycle()` and name the variable `clipCycle`.

5. targetName stability is critical. With random entry, calling resolveBaseClip every render would re-roll the target each render and cause thrash. Wrap it in useMemo keyed on `[chatStatus, currentAnimation, availableNames.join(" "), cycleOrder]`, passing `{ order: cycleOrder, rng: Math.random }`. Use the joined string because availableNames is a fresh array each render in VRMAvatar. Add an eslint-disable-next-line react-hooks/exhaustive-deps comment with a why-comment. The existing effect and step 0 consume the memoized targetName unchanged.

6. update() step 9: compute `const cyclePattern = STATUS_CLIP_PATTERNS[chatStatus];` and set `variants` to the availableNames matching cyclePattern when the status is in CYCLING_STATUSES and the pattern exists, else `[]`. Call `clipCycle.step({ chatStatus, currentAction: currentActionRef.current, currentClipName: currentClipNameRef.current, variants, delta, order: cycleOrder, minDwellSeconds, rng: Math.random })` and switchToClip on a non-null result. Rewrite the step-9 comment for the generalized scope and update the `9. talk-cycle` label in the composition-order comment to `9. status clip-cycle`. Update switchToClip's floor comment: cycle-triggered switches happen only in cycling statuses, so they never hit the starting/stopped floor.

7. Tests: add the resolveBaseClip option tests and shouldTriggerClipSwitch generalization tests above in new `it` blocks inside the existing describe blocks. If any existing test comment names `useTalkCycle`, update it to `useClipCycle` (L13 header comment).
  </action>
  <verify>
    <automated>cd /Users/whitemalt/Documents/khavee-sdk/packages/react && npx vitest run src/animation && npx tsc --noEmit -p .</automated>
  </verify>
  <done>All animation tests pass and tsc reports no errors. The controller accepts cycleOrder/minDwellSeconds, targetName is memoized, and step 9 cycles every cycling status.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: List-syntax AnimationConfig + avatar props + exports</name>
  <files>packages/react/src/animation/animationConfig.ts, packages/react/src/animation/animationConfig.test.ts, packages/react/src/VRMAvatar.tsx, packages/react/src/GLBAvatar.tsx, packages/react/src/index.ts, apps/playground/src/app/animation-test/page.tsx</files>
  <behavior>
    - expandAnimationConfig(undefined) returns []
    - expandAnimationConfig({ idle: "/a.fbx" }) returns [["idle", "/a.fbx"]], so plain strings are unchanged
    - expandAnimationConfig({ idle: ["/a.fbx", "/b.fbx"], talk: "/t.fbx" }) returns [["idle_0","/a.fbx"],["idle_1","/b.fbx"],["talk","/t.fbx"]], preserving insertion order
    - expandAnimationConfig({ idle: [] }) returns []; a single-element array returns [["idle_0", url]]
  </behavior>
  <action>
1. Create packages/react/src/animation/animationConfig.ts. It must be pure, with no drei or three imports, so vitest can load it cheaply. It contains:
   - `export interface AnimationConfig { [name: string]: string | string[] }`, with JSDoc showing both forms. Array entries load as `${key}_0`, `${key}_1`, ..., so status pattern matching on the key (e.g. "idle" matching /idle|ready|rest/i) still works (decision 3).
   - `export function expandAnimationConfig(config: AnimationConfig | undefined): Array<[name: string, url: string]>`. Document that a colliding explicit key (e.g. both `idle_0: "..."` and `idle: [...]`) resolves to whichever entry comes last, matching Object/Record overwrite semantics downstream.
   Write animationConfig.test.ts first with the behaviors above.

2. VRMAvatar.tsx:
   - Delete the local AnimationConfig interface. Import AnimationConfig and expandAnimationConfig from "./animation/animationConfig", and re-export the type with `export type { AnimationConfig } from "./animation/animationConfig";` so index.ts's existing `export type { AnimationConfig } from "./VRMAvatar"` keeps working.
   - In useAnimationFiles, replace `Object.entries(animationUrls).forEach(([name, url])` with `expandAnimationConfig(animationUrls).forEach(([name, url])`. This flattens before the hook loop, so hook count is a pure function of the config, same as today. Keep the useMemo key `JSON.stringify(animationUrls)` unchanged (decision 3). Add a one-line why-comment.
   - Extend the component JSDoc example (L170-183) to show `talk: ['/animations/talk1.fbx', '/animations/talk2.fbx']`.
   - Add props to VRMAvatarProps with single-line `/** */` docs:
     - `animationCycleOrder?: AnimationCycleOrder`: how clips rotate while ready/listening/thinking/speaking when 2+ clips match; "random" never repeats back-to-back; default "random".
     - `animationMinDwellSeconds?: number`: minimum seconds a clip plays before the cycle may swap it (the swap still waits for a loop boundary); default 2.
     Import the AnimationCycleOrder type from "./animation/AnimationStateEngine". Add both to the `@param` JSDoc list and the destructure with no default (the controller applies the defaults, so there is a single source of truth). Pass `cycleOrder: animationCycleOrder, minDwellSeconds: animationMinDwellSeconds` into useAnimationController (decision 5).
3. GLBAvatar.tsx: add the same two props, JSDoc, destructure and controller threading. GLB clip names come from the embedded GLB, so there is no AnimationConfig change there.
4. index.ts: add `export type { AnimationCycleOrder } from "./animation/AnimationStateEngine";`. Do not export talkCycle/animationConfig internals beyond the AnimationConfig type.
5. Optional (decision 11), comment-only and cheap: in apps/playground/src/app/animation-test/page.tsx, replace the commented `talking`/`talking1`/`talking2` lines in VRM_ANIMATIONS with one commented list-syntax example `// talking: ['/models/animations/talk.fbx', '/models/animations/talk2.fbx', '/models/animations/talk3.fbx'], // speaking variants cycle`. Do not change any active entry or the untracked .fbx files.

Constraints: do not touch packages/providers/openai-stt-tts (decision 9). Never start dev servers.
  </action>
  <verify>
    <automated>cd /Users/whitemalt/Documents/khavee-sdk/packages/react && npx vitest run && pnpm --filter @khaveeai/react build</automated>
  </verify>
  <done>The full packages/react vitest suite passes and the react package builds. Both avatars expose animationCycleOrder and animationMinDwellSeconds wired into the controller. AnimationConfig list syntax loads as `${key}_N` clips. AnimationCycleOrder is exported from @khaveeai/react.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| app code → avatar props | Developer-supplied config/props (URLs, dwell number); no end-user or network input crosses here |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-gzb-01 | Denial of Service | minDwellSeconds prop | mitigate | Sanitize non-finite/negative values to MIN_TALK_DWELL_SECONDS in useAnimationController. Switches are still gated by the loop boundary, so even dwell 0 cannot switch every frame |
| T-gzb-02 | Denial of Service | targetName re-resolution | mitigate | Memoize the random-entry targetName so re-renders (volume ticks) cannot re-roll it and thrash crossfades |
| T-gzb-03 | Tampering | AnimationConfig URLs | accept | Same trust level as today's string URLs, loaded via drei; no new fetch surface |
</threat_model>

<verification>
- cd packages/react && npx vitest run (all green, including gesture.test.ts)
- pnpm --filter @khaveeai/react build (tsc clean)
- `git diff --stat` shows no changes under packages/providers/
- `grep -rn "useTalkCycle\|stepTalkCycle\|speakingVariants" packages/react/src` returns only historical prose (no code references)
</verification>

<success_criteria>
- All four cycling statuses rotate matching clips at loop boundaries after the configurable minimum dwell; starting/stopped do not rotate
- "random" (default) never repeats back-to-back and randomizes entry; "sequential" keeps round-robin and first-match entry
- AnimationConfig list syntax works and plain strings are unchanged
- Both VRMAvatar and GLBAvatar expose and thread animationCycleOrder and animationMinDwellSeconds
- Commits use conventional-commit messages on feat/animation-cycling with NO Claude co-author/attribution lines (decision 10)
</success_criteria>

<output>
Create `.planning/quick/260918-gzb-animation-state-cycling/260918-gzb-SUMMARY.md` when done
</output>
