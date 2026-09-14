---
spike: 005
name: lighting-contrast-rebaseline
type: standard
validates: "Given a prototype three-point rig with a rim light, when contrast and saturation are re-measured under it for both ACESFilmic and Cineon, then the correct Phase 16 contrast gate is known (superseding the 0.3041 figure measured under old lighting)"
verdict: PARTIAL
related: [002, 003, 004, 006, 007]
tags: [lighting, measurement, tonemapping, rebaseline]
---

# Spike 005: Lighting Contrast Re-baseline

## What This Validates

**Given** a prototype three-point rig with a rim light, **when** contrast and saturation are
re-measured under it for both ACESFilmic and Cineon, **then** the correct Phase 16 contrast gate
is known — superseding the `0.3041` figure that CONTEXT D-11 currently sets as the gate.

Raised during frontier analysis, not from the phase scope: spike 002 states its lighting was
*"copied verbatim from khavee-app's"* production setup and spike 003 measured *"under fixed
lighting"*. Phase 16 replaces that lighting, so the number Phase 16 is being held to was measured
under conditions Phase 16 destroys.

## Research

No external research needed — the question is about this repo's own measurement conditions. What
was needed was reading `mtoon-spike/page.tsx` (the page spike 003 actually ran on) instead of
assuming its setup. That reading is the spike's main result.

## How to Run

```bash
pnpm dev      # run it yourself — see Investigation Trail on why
# open http://localhost:3000/lighting-spike
```

Toggle `rig` / tone curve / `backdrop` and read the **live measurement** panel. Prefer the live
panel over `run sweep`; see Investigation Trail.

## Investigation Trail

**Iteration 1 — built three rigs side by side.** `legacy` (reproducing production), `sdk-current`
(the shipped `AvatarLightRig`), and a `three-point` prototype with key + cool fill + rim. Added a
12-combination sweep over rig x tone curve x `materialPreset`, with a deliberate validity check:
the `legacy` + `ACESFilmic` + repair-`off` row should reproduce spike 003's
`0.3750 / 0.3307 / 0.3041`.

**Iteration 2 — the validity check failed, which is why it existed.** Measured
`0.4583 / 0.5887 / 0.0973`: +78% brightness and −68% contrast against the target. Rather than
adjust anything to fit, went and read the conditions spike 003 actually ran under.

**Iteration 3 — the conditions differ in four ways, not one.**

| | spike 003 (`mtoon-spike`) | this harness (before fixes) |
|---|---|---|
| Render path | `<primitive object={vrm.scene} />` — raw VRM | `VRMAvatar` (adds `applyMeshRenderFlags`, forces cast/receive shadow on every mesh) |
| Camera | `fov 20` @ `z=4` — tight crop, excludes the dark trousers | `fov 50` @ `z=3` — full body |
| Ambient | `0.7` | `0.6` (guessed, wrong) |
| `materialPreset` | repair **OFF** for the `spread` column | defaults to `repair` since Phase 15 |

Three were fixed (ambient corrected to 0.7 against source, tone curve driven through `VRMAvatar`'s
own `toneMapping` prop instead of fighting `applyRendererDefaults` from a sibling effect, and a
`match 003 framing` toggle added). The render-path difference cannot be fixed without abandoning
`VRMAvatar`, which is the thing Phase 16 actually ships.

**Iteration 4 — a second measurement barely moved, so the sweep itself became suspect.**
After correcting ambient by +17% the same row returned `0.4574 / 0.5897 / 0.0969` — a 0.17% change
in brightness where a visible one was expected. Two explanations were possible and the numbers
could not distinguish them: the sweep's state changes were not reaching the rendered frame, or the
controls were not reaching the render at all. Added a **live measurement** panel sampling every
500ms, independent of the sweep, to separate them.

**Iteration 5 — browser automation cannot answer this, confirmed twice.** Driving the page through
Chrome automation, the live panel never appeared at all: `measureCanvas` returned `null` on every
sample, meaning zero opaque pixels, while screenshots of the same tab plainly showed a rendered
avatar. Cause is the same one spike 004 hit: the automated tab is `visibilityState: "hidden"`,
`requestAnimationFrame` is throttled to ~1Hz, and the WebGL drawing buffer is empty at most moments
`setInterval` samples it. **Pixel measurement, like frame timing, is only valid in a visible,
focused tab.**

**What automation could still settle** — screenshots force a paint, so visual comparison works even
when measurement does not:
- Toggling `backdrop` visibly removes the backdrop; the avatar renders against transparency.
- Toggling `legacy` → `three-point` visibly changes the render — a rim appears along the right
  shoulder and arm and a cool highlight on the hair.

That kills the "controls are not reaching the render" branch: the rigs **are** applied. The sweep's
timing remains the open suspect.

**Unresolved.** Two things are still unexplained and are deliberately not being guessed at:
- `coveredPixels` reads ~109k of 262k (42% of frame) with the backdrop off. The avatar's silhouette
  against black should be far less. Something other than the avatar is being counted.
- `valueSpread` of ~0.097 is implausibly flat for a character with a navy vest, black trousers and
  a bright face.

Until those are explained, **no number from this harness should be used**, including any number
that happens to look reasonable.

## Results

### Primary result — the gate in CONTEXT D-11 is not portable, and the reason is structural

`0.3041` was measured on a different render path (raw `<primitive>` vs `VRMAvatar`), at a different
framing (`fov 20 @ z4` vs `fov 50 @ z3`), under a different ambient, with repair OFF at a time when
repair now defaults ON. It is not a "same measurement under different lighting" — it is a different
measurement.

Framing alone is enough to invalidate it: `measureCanvas` averages over avatar pixels, and a tight
crop that excludes the dark trousers samples a materially brighter, differently-distributed set of
pixels than a full-body framing. The number is an artifact of its harness.

**Therefore D-11's gate must change from an absolute threshold to a within-harness comparison:**

> The three-point rig must measure **contrast greater than or equal to the `legacy` rig**, both
> measured in the same harness, same framing, same `materialPreset`, in the same session.

This answers the spike's question. It is a stronger result than expected — the hypothesis was
"the lighting changed so re-measure", and the finding is "the measurement system changed too, so
absolute comparison across spikes is invalid in principle".

### Secondary result — the rim reads, but weaker than a headline feature should

Visual A/B confirms the three-point rig produces a rim on the shoulder and arm and a cool hair
highlight, but the effect is subtle rather than the signature look the roadmap describes. The
prototype's starting values (`rim: 1.6`, `ambient: 0.32`) are a floor to tune up from, not a
finished rig.

### Pending

The actual numbers. Needs a human running the live panel in a visible tab, plus an explanation for
the 109k coverage and the flat spread.

## Verdict

**PARTIAL.** The question "what is the correct gate?" is answered, and answered more definitively
than a number would have: no absolute figure carried across harnesses is valid, so the gate must be
a same-harness delta. The measurements themselves are not yet trustworthy and are explicitly
withheld rather than reported.
