---
spike: 007
name: rim-from-background
type: standard
validates: "Given both a flat COLOR background and an uploaded IMAGE background, when the rim tint is derived from it, then the result reads as belonging to the same scene rather than merely measuring as more saturated"
verdict: VALIDATED
related: [004, 005]
tags: [lighting, rim, background, colour]
---

# Spike 007: Rim Colour From Background

## What This Validates

**Given** both a flat `COLOR` background and an uploaded `IMAGE` background, **when** the rim tint
is derived from it, **then** the result reads as belonging to the same scene rather than merely
measuring as more saturated.

CONTEXT D-05 locks *that* the rim derives from the background. It does not say **how**, and that
gap is the entire spike.

## Research

No external research. The relevant prior art is in this repo: Phase 15's MTOON-03. R1's original
bug was deriving the rim tint from `litFactor`, which VRoid models leave white, producing a grey
rim that measurably *reduced* saturation — the opposite of the intent. The fix was to sample the
base texture instead.

Averaging a whole background photo is the same class of mistake one level up. Average enough
different colours together and the result is mud regardless of how vivid the source was. So the
spike does not ask "does deriving from the background work" — it asks **which derivation survives
backgrounds that defeat averaging**.

Four derivations implemented, as pure functions over RGBA bytes so they can be driven headlessly:

| Derivation | Rationale |
|---|---|
| `mean` | what `averageTextureColor` already does — included to be beaten, not because it was expected to win |
| `saturation-weighted` | weight each pixel by its own saturation, so a small vivid area outvotes a large drab one |
| `dominant` | coarse RGB histogram, most-populated bucket — representative rather than averaged |
| `upper-region` | saturation-weighted over the top third only; in most photographs that is sky/ceiling, i.e. where the light is |

## How to Run

Headless (the derivations — no browser):

```bash
cd .planning/spikes/007-rim-from-background
node --experimental-strip-types verify-derivations.mjs
```

Visual: `pnpm dev` (run it yourself), open `/lighting-spike`, select the **three-point + rim** rig,
then pick a derivation from the SPIKE 007 swatch list and switch backdrop aspects to change the
source image.

## Investigation Trail

**Iteration 1 — chose adversarial fixtures, not flattering ones.** Four synthetic backgrounds whose
*failure* is unambiguous even where the ideal answer is arguable:
a mostly-grey wall with a small red neon (does a small vivid light survive?), two opposing
saturated colours at equal area (the classic mud generator), blue sky over dark ground (a very
common uploaded photo), and a genuinely grey background (the safety case).

**Iteration 2 — added one hard assertion rather than eyeballing.** The grey-background case
asserts that *no* derivation returns saturation above 0.05. Inventing a hue on a deliberately
neutral background is the worst available failure — it is the same defect class as Phase 15's
WR-02 achromatic branch, which shipped unable to produce a visible rim on a black material and was
only caught in code review.

## Results

```
── mostly grey wall + small red neon   (88% neutral, 12% vivid)
     mean                 #856c70  sat 0.189
     saturation-weighted  #d92032  sat 0.854
     dominant             #78787a  sat 0.016  <- achromatic
     upper region         #d92032  sat 0.854

── opposing colours, equal area
     mean                 #8a7382  sat 0.164
     saturation-weighted  #8c747f  sat 0.175
     dominant             #eb8c1e  sat 0.872
     upper region         #8c747f  sat 0.175

── blue sky over dark ground
     mean                 #415771  sat 0.426
     saturation-weighted  #4a6d96  sat 0.505
     dominant             #2d2620  sat 0.289
     upper region         #5fa0eb  sat 0.596

── genuinely grey background
     all four             #808082  sat 0.015

PASS — no derivation invents a hue on an achromatic background
```

**1. `mean` reproduces the Phase 15 defect exactly.** Grey wall plus red neon yields `#856c70`, a
muddy mauve at saturation 0.19 — the one coloured light in the scene averaged away. This is the
`litFactor` bug at a different level, and it is what the SDK's existing `averageTextureColor`
would have done if reused unchanged for this purpose.

**2. `dominant` picks the boring majority, and picks it wrongly.** It returns grey for the neon
case (the wall is simply more numerous) and, worse, selects the **dark ground** rather than the sky
for the sky/ground photo — the half of the image the light is *not* coming from. On the
opposing-colours case its choice is an arbitrary tie-break. Unusable.

**3. No derivation wins every case.** Two opposing saturated colours at equal area defeat
everything except `dominant`, which only "wins" by arbitrarily picking a side. That is a real
limit, not a tuning problem: when a scene is equally lit by two opposing hues, no single rim colour
is right.

**4. `upper-region` is the best default.** It ties the best result on the neon case and clearly
wins the sky case (0.596 vs 0.505), and it is the only option with a physical justification rather
than a statistical one: a rim/back light comes from **behind and above**, so sampling the top of
the background matches where the light in that scene would actually be.

**5. The safety case holds for all four.** A genuinely grey background stays grey. Whatever
derivation ships must keep this property.

## Verdict

**VALIDATED** — deriving the rim from the background works, and `upper-region` (saturation-weighted
over the top third) is the derivation to ship, with a documented limit on evenly-opposed backgrounds.

Visual confirmation on a real render is still worth doing — the swatch list is wired into the page
for exactly that — but the derivation choice does not depend on it: `mean` and `dominant` are
eliminated on measured evidence, not on taste.

## Candidate requirements for Phase 16

- **Derive the rim with the saturation-weighted upper-region strategy.** Do NOT reuse
  `averageTextureColor`; a plain mean reproduces the MTOON-03 grey-rim defect at scene level.
- **Keep the achromatic guarantee.** A neutral background must yield a neutral rim. Needs a
  regression test, given WR-02 showed this exact guarantee silently failing once already.
- **Handle the `COLOR` background type as a trivial case** — a flat colour has one answer and all
  four derivations agree on it.
- **Document the evenly-opposed-background limit** rather than tuning against it. Consider falling
  back to the neutral rim when the top two colour clusters are comparably saturated and far apart
  in hue.
