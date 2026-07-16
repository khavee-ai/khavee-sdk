---
phase: 11-idle-transition-talking-states
plan: 14
subsystem: animation
tags: [react, three.js, vrm, glb, crossfade, procedural-animation, gap-closure, verification]

# Dependency graph
requires:
  - phase: 11-idle-transition-talking-states
    provides: "11-13's shouldTriggerClipSwitch (G1/G3 fix) and isBaseActionMeaningfullyDriving (G4 fix), both new exported pure functions, plus the runtime-evidenced diagnosis recorded in AnimationStateEngine.ts's 11-13 gap closure header block"
provides:
  - "Task 1: all 10 objective + fix-landed gates (5 invariant, 5 fix-landed incl. full 93/93 test suite) confirmed PASS at the code level, clearing the plan to present the Task 2 decisive human checkpoint"
  - "Task 2: human verdict recorded — G1 (pre-connect live idle pose), G3 (Y-drop on Connect), G4 (talk-cycle jiggle), G2 (idle->talking crossfade), and the 7-requirement regression sweep are all APPROVED as checked. HOWEVER a new/refined finding (G5) was surfaced by the human during verification: a visible Y-axis drop still occurs during the initial T-pose-to-idle settle on first page load (before Connect is pressed) — the drop has relocated from connect-time (G3, now fixed) to load-time. This is NOT resolved and is NOT silently treated as a pass. Phase 11 gap closure is NOT complete; a fifth round is needed to root-cause and fix G5."
affects: ["11-15 (or the next gap-closure plan, still to be created)"]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified: []

key-decisions:
  - "Task 1 executed all 10 gates exactly as specified (5 invariant gates reused verbatim from 11-12 for round-to-round comparability, 5 fix-landed gates targeting 11-13's SPECIFIC change) before any checkpoint content was presented — no gate was skipped or inferred."
  - "Gate 7 (the specific G1 fix) was verified by grepping for shouldTriggerClipSwitch's three call sites in AnimationStateEngine.ts (definition at line 511, useEffect call at line 651, update() step-0 per-frame retry call at line 706) rather than a generic keyword grep, confirming the exact mechanism 11-13-SUMMARY.md describes is actually present in the shipped file."
  - "This is a verification-only plan (files_modified: [] per frontmatter) — no source files were changed during Task 1; all 10 gates were read-only checks (grep/test run) against 11-13's already-committed code."
  - "Task 2's human verdict is recorded verbatim, per item, exactly as reported — no item was inferred or upgraded to a pass. The human's new G5 observation (Y-drop relocated from connect-time to the initial T-pose-to-idle load-time settle) is recorded as an open, unresolved finding, not glossed over or folded silently into G3's 'fixed' status. Phase 11 gap closure is explicitly NOT declared complete."

requirements-completed: []  # NOT populated — G5 (Y-axis drop during initial T-pose-to-idle settle) is a newly-surfaced, unresolved finding. IDLE-01/02, TRANS-01/02, TALK-01/02, PERF-01 cannot be finalized until a fifth gap-closure round addresses G5.

# Metrics
duration: ~15min (Task 1 gates + dev-environment setup + Task 2 checkpoint)
completed: 2026-07-17
---

# Phase 11 Plan 14: Fourth-round re-verification — Task 1 gates PASS; Task 2 finds G1/G2/G3/G4 fixed but surfaces a new G5 (Y-drop relocated to initial load-time settle) — gap closure NOT yet complete Summary

**All 10 code-level gates PASS (93/93 tests green) and the human confirmed G1 (pre-connect T-pose), G3 (connect-time Y-drop), G4 (talk-cycle jiggle), G2 (idle->talking crossfade), and the full 7-requirement regression sweep are all fixed/working — but the human also observed a new Y-axis drop during the initial T-pose-to-idle settle on first page load, questioning "shouldn't it not drop?" — this G5 finding is unresolved and Phase 11 gap closure remains open.**

## Performance

- **Started:** 2026-07-17T02:41Z (approx)
- **Task 1 completed:** 2026-07-17T02:42Z
- **Task 2 (checkpoint) resolved:** 2026-07-17 (human verdict received)
- **Tasks:** 2 of 2 completed (checkpoint resolved with a mixed verdict — see below)
- **Files modified:** 0 (verification-only plan)

## Accomplishments (Task 1)

Ran all 10 gates specified in the plan, in order, recording each PASS/FAIL before considering the Task 2 checkpoint:

### Invariant gates (must still hold after 11-13) — reused verbatim from 11-12

1. **Timer-free:** `grep -rn --include='*.ts' -E "setInterval|setTimeout" packages/react/src/animation/` (excluding comment lines) → **0 matches. PASS.**
2. **Additive-not-overwrite:** `breathing.ts` — `.quaternion.set(` count 0, `.multiply(` count 3. `sway.ts` — `.quaternion.set(` count 0, `.multiply(` count 2. Both files: 0 overwrite calls, ≥1 multiply call. **PASS.**
3. **Internal-only:** `grep -E "breathing|sway|expressionDrift|talkCycle|audioAmplitude" packages/react/src/index.ts` → **0 matches** (none of the procedural systems are exported). **PASS.**
4. **IDLE-02 intact:** `expressionDrift.ts` line 177 — `export const DEFAULT_AMPLITUDE = 0.35;` (the 11-09 value, unchanged) — plus drift-ownership tracking (`lastWritten` guard, `ownership` comments at lines 37-45) still present. **PASS.**
5. **PERF-01 intact:** `MAX_COMBINED_SPINE_DELTA_RAD = 0.12` present at `AnimationStateEngine.ts:291`, used in the clamp at lines 857-858; `breathing.step(...)` called at line 837, `sway.step(...)` called at line 845 (both still called, guarded not deleted). **PASS.**

### Fix-landed gates (prove 11-13 is present, neither prior bug reintroduced)

6. **11-13 diagnosis present:** `AnimationStateEngine.ts` contains a `11-13 gap closure` header block (line 116) — 11-09 (line 13) and 11-11 (line 47) blocks also still present, additive not replaced. **PASS.**
7. **G1 fix present (specific, not generic):** `shouldTriggerClipSwitch` — defined once at line 511, called by the crossfade-trigger `useEffect` at line 651, called by `update()`'s new per-frame retry (step 0) at line 706. This matches 11-13-SUMMARY.md's described mechanism exactly (one exported pure decision function called identically by both the change-driven effect and the self-terminating per-frame retry). **PASS.**
8. **Spin NOT reintroduced:** `MIN_BASE_ACTION_WEIGHT = 0.05` unchanged at line 300 (not lowered); the 11-09 first-mount compounding repro test (`describe("first-mount procedural-write accumulation repro (11-09)"...`) present at test file line 150. **PASS.**
9. **G2 snap NOT reintroduced:** the 11-11 G2 non-snap multi-frame-ramp test (`describe("G2 fix — idle->talking crossfade still ramps smoothly over multiple frames after a second switch (11-11)"...`) present at test file line 376. **PASS.**
10. **Full suite:** `pnpm --filter @khaveeai/react test` → **93/93 tests passed across 7 suites** (audioAmplitude 4, talkCycle 9, expressionDrift 7, crossfade 15, breathing 8, sway 7, AnimationStateEngine 43) — exceeds the ">= 80 tests plus 11-13's new regression tests" acceptance bar (11-13 recorded 93/93 as its own post-fix baseline; this run reproduces that exact count from a clean `pnpm install --frozen-lockfile` in a fresh worktree). `npx tsc --noEmit` in `packages/react` also clean (no output). **PASS.**

All 10 gates PASS. Per the plan's explicit instruction ("If ANY gate fails, STOP and report before presenting the Task 2 checkpoint"), this clears the plan to present Task 2's decisive human-verify checkpoint.

## Accomplishments (Task 2 — decisive human checkpoint)

Before presenting the checkpoint, the dev environment was prepared and verified: `.env` copied from the root repo into this worktree, dev server started fresh from this worktree's source on `http://localhost:3000`, and both target pages confirmed `200` (`/openai-avatar-test`, `/glb-avatar-test`) prior to presenting anything to the human.

**Human verdict, recorded verbatim per item — no item inferred or upgraded:**

1. **G1 (pre-connect live idle pose):** **APPROVED**
2. **G3 (Y-drop on Connect):** **APPROVED** — no drop when pressing Connect
3. **G4 (talk-cycle jiggle):** **APPROVED** — smooth
4. **G2 (idle->talking crossfade):** **APPROVED** — smooth
5. **Full 7-requirement regression sweep (IDLE-01, IDLE-02, TRANS-01, TRANS-02, TALK-01, TALK-02, PERF-01):** **APPROVED as a batch.** The human approved the sweep as a whole, not as 7 individually-itemized confirmations — recorded here as a batch approval, not as 7 separate itemized verdicts, per the human's actual response.

**New finding surfaced during verification — recorded as an open issue, NOT a pass:**

Immediately after the above approvals, the human reported a new observation: on first render/page load — **before** Connect is ever pressed — the avatar's visible sequence is **"T-pose -> drop -> idle"**: it starts in T-pose, visibly **drops on the Y axis**, then settles into the live idle pose. The human explicitly questioned this ("shouldn't it not drop?"), signaling this reads as unexpected/undesired behavior, not an accepted pass.

This is tracked here as **G5** — a refined restatement of the Y-drop mechanism, not a duplicate of G3. G3 was specifically about a drop occurring at connect-time; G3 is now confirmed fixed. G5 is the same underlying Y-axis-drop motion (11-13's diagnosis already identified the hips-Y settle as a real, always-present crossfade artifact — see the file-header 11-13 block's H-G3 finding) but observed at a **different transition boundary**: the initial T-pose-to-idle settle that now happens at page-load time (a direct consequence of 11-13's G1 fix, which moved the base clip's first successful crossfade from "never before Connect" to "as soon as clips/root resolve on load"). The drop did not disappear — it relocated from the connect-time transition to the load-time transition.

**No severity or root cause is asserted here** — only what was explicitly reported. Whether this drop is the SAME magnitude/mechanism 11-13 measured for G3 (the ~1.008-unit hips Y ramp, smooth/eased per 11-13's own measurement) or a distinct, more visible artifact specific to the T-pose-to-idle boundary is NOT yet determined and requires further investigation in a subsequent gap-closure round.

## Task Commits

1. **Task 1: Objective invariant + fix-landed gates + full react test suite** — verification-only, no source changes (`files_modified: []` per plan frontmatter); recorded via this SUMMARY.md — `58054c3`.
2. **Task 2: Decisive human re-verification checkpoint** — verification-only, no source changes; human verdict (G1-G4 + 7-req sweep APPROVED, G5 surfaced as unresolved) recorded via this SUMMARY.md update.

**Plan metadata:** committed alongside this SUMMARY (see final commit in git log)

## Files Created/Modified

None — this entire plan (Task 1 and Task 2) is read-only verification (grep checks, `pnpm test`, `tsc --noEmit`, dev-server startup, and one live human visual/behavioral check). No source files were touched, consistent with the plan frontmatter's `files_modified: []`.

## Decisions Made

- Reused the exact 5 invariant gates from 11-12-SUMMARY.md verbatim (same grep patterns, same acceptance thresholds) so this round is directly comparable to the prior round, per the plan's explicit instruction.
- Verified Gate 7 (the G1 fix) against the SPECIFIC mechanism 11-13-SUMMARY.md claims — the shared `shouldTriggerClipSwitch` function's three call sites — rather than a generic "does the file mention G1" grep, per the plan's acceptance criteria ("Gate 7 verifies the SPECIFIC change... not a generic grep").
- Ran `pnpm install --frozen-lockfile` first since this is a fresh worktree with no `node_modules` (11-12 hit `vitest: command not found` under the same condition) — lockfile-pinned, no new packages, per this plan's own threat register (T-11-SC).
- Recorded the human's Task 2 verdict verbatim, including the newly-surfaced G5 finding, exactly as reported — did not infer, soften, or fold G5 into an existing "fixed" item, and did not mark it a pass by omission. The plan's own acceptance criteria explicitly require "no item is marked pass by inference" and this extends to new findings surfaced mid-checkpoint: an unprompted "this looks wrong" observation from the human is recorded as an open issue, not smoothed over.
- Treated the 7-requirement regression sweep's approval as a single batch verdict (matching how the human actually responded — "approve" for the whole sweep, not itemized) rather than fabricating 7 separate itemized confirmations that were never individually given.

## Deviations from Plan

None — both tasks executed exactly as written. Task 1's 10 gates were checked in the specified order with no gate skipped or inferred; Task 2's checkpoint was presented only after all 10 gates passed, with the dev environment prepared and verified (200 on both target pages) before presenting anything to the human, per the plan's automation-first requirement.

## Issues Encountered

- The zsh shell's glob expansion initially mis-parsed an unquoted `--include=*.ts` grep flag during Task 1 (harmless shell-level issue, not a code or gate problem) — resolved by quoting the flag; re-ran and confirmed the same 0-match result.
- Task 2's checkpoint surfaced a new, unresolved finding (G5 — see above) rather than a clean pass. This is not a plan-execution issue; it is the correct, intended outcome of running a decisive human-verify checkpoint — the checkpoint did its job by catching a real, reported regression-adjacent behavior that the code-level gates cannot detect.

## User Setup Required

None — no external service configuration required. The dev server and `.env` copy used for Task 2's checkpoint were both handled by this worktree agent (automation-first, per the plan and the parallel-execution instructions) — the human was only asked to observe the running app, never to run any CLI command.

## Next Phase Readiness

**Phase 11 gap closure is NOT complete.** G1, G2, G3, and G4 are all confirmed fixed by direct human observation, and the full 7-requirement regression sweep was approved as a batch. However, the human's new G5 observation — a visible Y-axis drop during the initial T-pose-to-idle settle on first page load (before Connect), relocated from where G3's connect-time drop used to occur — is an open, unresolved finding that requires a fifth gap-closure round to root-cause and fix, following the same headless-runtime-evidence discipline 11-11/11-13 established (do not assume the mechanism; measure it against the real production path). Candidate starting point for that round: 11-13's own H-G3 finding already measured a smooth, always-present hips-Y ramp (~1.008 units, eased, no discontinuity) driven by the SAME crossfade this file runs — the open question for the next round is whether G5 is that exact same eased motion (now simply visible at load time instead of connect time, and possibly acceptable/expected once seen in context) or a different-in-character artifact specific to the T-pose bind-pose starting point that warrants an actual code change (e.g. a bind-pose-aware initial hips Y correction, or hiding the avatar for one frame during the very first settle). This determination should NOT be assumed — it needs the same runtime-evidenced diagnosis discipline as the prior three rounds.

No STATE.md/ROADMAP.md/REQUIREMENTS.md updates were made by this worktree agent per the orchestrator's instructions — the orchestrator should record this plan's outcome (G1-G4 approved, G5 open, Phase 11 gap closure round 4 complete but NOT the final round) when merging this worktree's results back, and should plan a fifth gap-closure pass (11-15 or equivalent) targeting G5 specifically.

---
*Phase: 11-idle-transition-talking-states*
*Status: Both tasks complete. Checkpoint resolved with a mixed verdict — G1/G2/G3/G4 and the 7-requirement sweep APPROVED; G5 (Y-drop relocated to initial load-time settle) surfaced as a new, unresolved finding. Phase 11 gap closure is NOT complete; a fifth round is required.*

## Self-Check: PASSED

`.planning/phases/11-idle-transition-talking-states/11-14-SUMMARY.md` confirmed present on disk. Commit `58054c3` (Task 1 gate results) confirmed present in `git log --oneline --all`. This update (Task 2 verdict) is committed alongside this self-check line — see the next commit in the log.
