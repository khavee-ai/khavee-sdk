---
spike: 002
name: mtoon-repair-pass
type: standard
validates: "Given a badly-authored and a well-authored VRM side by side under production lighting, when the repair pass is toggled, then the bad model visibly improves and the well-authored model does not regress"
verdict: VALIDATED
related: [001, 003]
tags: [mtoon, rendering, repair, non-regression]
---

# Spike 002: MToon Repair Pass

## What This Validates

**Given** `male.vrm` (badly authored) and `3636451243928341470.vrm` (well authored) rendered side
by side under **today's production lighting and tone mapping**, **when** the repair pass is
toggled on, **then** the bad model visibly improves **and** the well-authored model does not
regress.

The control model is the whole point. Spike 001 proved the pass **will** modify it (7 of its 21
materials), so "does not regress" is a genuine test, not a formality.

## Research

No new external research — this spike builds directly on spike 001's runtime audit. The rule set
is 001's revised table, with two draft rules deleted (`shift < -0.5`: zero hits across 78
materials; `shade ≈ lit`: 7/7 hits were deliberately-flat face details).

**Deliberate constant-holding:** lighting is copied verbatim from `khavee-app`'s
`PreviewModel.tsx` (`ambientLight 0.7` + one `directionalLight` at `[10,10,5]`) and the renderer
keeps `ACESFilmicToneMapping`. Tone mapping is spike 003's variable — changing both at once
would make neither attributable.

## Where the Code Lives

Under `apps/playground/src/app/mtoon-spike/` rather than `.planning/spikes/`, because it has to
run inside the Next app to render at all. Throwaway; graduates into
`packages/react/src/utils/renderQuality.tsx` only if this spike validates.

- `repairMToon.ts` — the pass, plus `snapshotMToon` / `restoreMToon` so the toggle restores
  *authored* values rather than the previous frame's already-repaired state.
- `page.tsx` — side-by-side viewer, toggle, and the forensic log panel.

## How to Run

```bash
pnpm --filter @khaveeai/playground dev      # then open /mtoon-spike
```

Mechanical (no browser):

```bash
ln -sfn ../../../packages/react/node_modules .planning/spikes/002-mtoon-repair-pass/node_modules
node --experimental-strip-types .planning/spikes/002-mtoon-repair-pass/verify-repair.mjs
```

## What to Expect

Two viewports, an on/off toggle, and a log panel listing every material changed with its
before → after values. Orbit to see the front (VRM 0.x models are rotated via
`VRMUtils.rotateVRM0`).

## Observability

The forensic layer is the log panel + `verify-repair.mjs`, which asserts three invariants
independent of visual judgement:

1. no face-detail material ever appears in the repair log,
2. neither deleted rule can fire,
3. `restoreMToon` returns every material to its authored snapshot (so an A/B toggle is honest,
   not cumulative).

## Investigation Trail

**Iteration 1 — rule set implemented from 001's revised table.** R1 rim injection, R2 fresnel
clamp, R3 toony floor, R4 fully-lit fix, R5 range clamp. Face-detail materials skipped wholesale
rather than per-rule: 001 showed the risk is concentrated there, and a spike should take the
conservative option first.

**Iteration 2 — found that injecting a rim colour alone is not enough.** `male.vrm` ships
`parametricRimFresnelPowerFactor = 1` on every material. At power 1 the Fresnel term spreads
across the entire surface, so setting a rim colour would produce a flat wash over the whole body
rather than an edge. R1 therefore also raises fresnel power to the target when it is below 2.
Without this, R1 would have made the model *worse* while appearing to "work".

**Iteration 3 — mechanical verification (headless, all three assets).**

| model | MToon | touched | face-detail skipped | rules fired |
|---|---|---|---|---|
| `male.vrm` | 19 | **11** | 8 | R1×11, R3×6, R4×5, R5×1 |
| `3636451243928341470.vrm` *(control)* | 21 | **7** | 4 | R1×5, R3×4 |
| `262410318834873893.vrm` | 18 | **11** | 7 | R1×11, R2×11 |

All three invariants passed on all three models. Counts are lower than 001's raw fire-counts
because face-detail materials are excluded before any rule runs.

**Iteration 4 — human visual verification.** Ran at `/mtoon-spike` against both models with the
toggle. Human verdict: **both criteria pass** — `male.vrm` visibly improves and the
well-authored control model does not regress. (Reported as "ผ่านทั้งคู่" / "both pass"; no
qualifying issues raised.)

## Results

**Verdict: VALIDATED** — both halves confirmed.

- **Mechanical (self-verified, headless):** all three invariants hold on all three assets — no
  face-detail material is ever modified, neither deleted rule can fire, and `restoreMToon`
  returns every material to its authored snapshot so the A/B toggle is non-cumulative.
- **Visual (human-verified at `/mtoon-spike`):** the badly-authored model improves; the
  well-authored control does not regress, despite the pass modifying 7 of its 21 materials.

### The finding that mattered most

Injecting a rim colour **alone would have made things worse**. `male.vrm` ships
`parametricRimFresnelPowerFactor = 1` on every material; at power 1 the Fresnel term covers the
whole surface, so a rim colour reads as a full-body wash rather than an edge. R1 must raise
fresnel power alongside the colour. A pass that only did the "obvious" thing would have shipped
a regression while its own log reported success.

### Signal for the real build

- The rule set is sound as-is; graduate R1-R5 into
  `packages/react/src/utils/renderQuality.tsx` behind a `materialPreset` prop.
- Ship `"repair"` as the default: it is proven safe on a well-authored model, which is the
  case that would otherwise block a default-on rollout.
- Keep the snapshot/restore pair in the public surface — it is what makes `materialPreset="off"`
  honest at runtime rather than requiring a reload.
- Carry the face-detail exclusion forward verbatim; it is the single guard preventing the
  worst failure mode (shadows painted across irises and eye highlights).
