---
spike: 003
name: tonemapping-toon
type: standard
validates: "Given the same MToon avatar, when renderer tone mapping is switched live across None/Neutral/ACESFilmic/AgX/Reinhard/Cineon, then a curve is identified that preserves toon saturation better than today's ACESFilmic default"
verdict: VALIDATED
related: [001, 002]
tags: [mtoon, tonemapping, rendering, measurement]
---

# Spike 003: Tone Mapping for Toon Output

## What This Validates

**Given** the same MToon avatar under fixed lighting, **when** the renderer's tone mapping is
switched live across the six curves three r180 ships, **then** a curve is identified that
preserves toon saturation better than the current `ACESFilmicToneMapping` default.

## Research

- **MToon is genuinely affected.** `@pixiv/three-vrm-materials-mtoon@3.4.2`'s fragment shader
  includes `<tonemapping_fragment>` (verified by reading the built shader source), so the
  renderer-global curve lands on toon surfaces exactly as it does on PBR ones. This was an
  assumption worth checking — a toon shader that bypassed tone mapping would make the whole
  spike moot.
- **Rim light is hit hardest.** Per the MToon spec, parametric rim lighting is *additively*
  blended after the lighting result, which puts it in the brightest part of the image — precisely
  the range a filmic curve compresses most. So the curve choice interacts directly with spike
  002's R1 rim injection.
- **Curves available in three r180:** `NoToneMapping`, `LinearToneMapping`,
  `ReinhardToneMapping`, `CineonToneMapping`, `ACESFilmicToneMapping`, `AgXToneMapping`,
  `NeutralToneMapping`, `CustomToneMapping`.

| Curve | Designed for | Expected on toon |
|---|---|---|
| `ACESFilmic` *(today's default)* | film/HDR PBR | desaturates mid-tones, lifts contrast filmically |
| `AgX` | modern filmic grading | desaturates harder than ACES |
| `Neutral` (Khronos PBR Neutral) | preserving in-gamut colour, compressing only highlights | best fit on paper |
| `None` | no curve | exact authored colour, but values > 1 clip hard (bad with bloom) |
| `Reinhard` / `Cineon` | legacy HDR | included as controls |

**Chosen approach:** measure rather than eyeball. See below.

## Method — why a slider and a sweep, not an A/B

A tone-mapping curve changes **brightness and saturation together**. A naive A/B toggle is
therefore easy to misread as "the brighter one looks better", which would pick a curve for the
wrong reason. Two countermeasures:

1. **Exposure slider** — brightness can be matched by hand before judging colour.
2. **Automated sweep** (`measureSaturation.ts`) — steps through every curve, lets two frames
   render, samples the canvas, and reports mean HSV saturation, mean value, and value spread
   (a crude shading-contrast read) over **avatar pixels only**. The R3F canvas is transparent,
   so alpha masks out the page background; the canvas is created with
   `preserveDrawingBuffer: true` so pixels survive to be read back.

## How to Run

```bash
pnpm --filter @khaveeai/playground dev      # then open /mtoon-spike
```

Use the **Tone mapping** dropdown and **Exposure** slider to judge by eye; press
**Sweep + measure** for the numeric table. Spike 002's `Repair` toggle is independent — run the
sweep with repair both OFF and ON, since R1's injected rim is the part most exposed to the curve.

## What to Expect

A numeric table per curve. The prediction under test:
`Neutral` shows **higher mean saturation than ACESFilmic at comparable mean value**. If it shows
higher saturation only because it is also brighter, the exposure slider should be used to match
brightness before the result counts.

## Observability

`measureSaturation.ts` — mean HSV saturation, mean value, mean absolute value-deviation, and
covered-pixel count (a sanity check that the avatar actually rendered before sampling).

## Investigation Trail

**Iteration 1 — built on spike 002's page rather than a new one.** Holding lighting, camera and
models identical across 002 and 003 means the two variables (materials, tone curve) can be moved
one at a time on the same scene, and their interaction (rim vs curve) can be observed directly.

**Iteration 2 — added measurement after recognising the confound.** Brightness and saturation
move together under a curve change; a purely visual verdict here would not be trustworthy.

**Iteration 3 — measured sweep, both repair states.** Numbers below. The brightness confound the
exposure slider was built for turned out not to apply: Neutral beats ACES on saturation while
being *darker*, so no exposure matching was needed to make the comparison honest.

**Iteration 4 — human aesthetic pick diverged from the metric winner.** Neutral tops the
saturation metric, but the human chose Cineon after viewing all six. Both readings are recorded;
the metric answered the spike's stated question, the human chose the default.

## Results

**Verdict: VALIDATED** — a curve that preserves toon saturation better than `ACESFilmicToneMapping`
exists, and several do.

### Sweep — `male.vrm`, exposure 1.00

| curve | meanSat (repair OFF) | meanSat (repair ON) | meanVal (OFF) | spread (OFF) |
|---|---|---|---|---|
| **Neutral** | **0.6526** | 0.6111 | 0.3123 | 0.2662 |
| **Cineon** *(chosen)* | 0.5066 | 0.4665 | 0.3248 | 0.2898 |
| ACESFilmic *(today)* | 0.3750 | 0.3460 | 0.3307 | **0.3041** |
| AgX | 0.3264 | 0.2987 | 0.3381 | 0.2454 |
| None | 0.2753 | 0.2550 | 0.3569 | 0.2552 |
| Reinhard | 0.2563 | 0.2365 | 0.3141 | 0.2063 |

### Findings

**1. The hypothesis holds, and the brightness confound never materialised.** Neutral reaches
+74% saturation over ACESFilmic *at a lower mean value* — darker AND more colourful. The
exposure slider was built to control for "brighter reads as better"; it was not needed, because
the winner is not the brighter one.

**2. Prediction refuted — `NoToneMapping` does NOT give "exact authored colour".** It measured
0.2753, second-lowest of six. Mechanism: with no curve, values above 1.0 clip **per channel**, so
a bright pixel like `(1.4, 1.1, 0.9)` becomes `(1.0, 1.0, 0.9)` — the channels are pushed toward
equality and saturation is destroyed. The brighter the surface, the flatter its colour. "Turn
tone mapping off for a flat toon look" is bad advice and should not be offered as an option.

**3. ACESFilmic wins exactly one axis: contrast.** Its `spread` of 0.3041 is the highest. Moving
off it costs some tonal separation — which should be recovered from the light rig and
`shadingToonyFactor`, not from the tone curve.

**4. Human preference and metric agree on the losers, diverge on the winner.** The human rejected
AgX and Reinhard unprompted as "จืดไป" (too washed out) — the two lowest-saturation curves after
`None`. That independent agreement validates the measurement itself. On the winner they chose
**Cineon** over the metric-topping Neutral, and the numbers support it as the better *trade*:
+35% saturation over ACES for only 0.0143 of lost spread, where Neutral pays 0.0379 of spread for
its extra saturation. Cineon is the best saturation-per-unit-contrast on the board.

**5. NEW BUG in spike 002's R1 — the injected rim is achromatic on most materials.** Repair ON
*lowers* saturation on every single curve (Neutral 0.6526 → 0.6111, ACES 0.3750 → 0.3460). The
log shows why: R1 derives the rim from `m.color` (`litFactor`), but VRoid-authored models
overwhelmingly leave `litFactor` white and keep the real colour in the base **texture** — so the
injected rim comes out grey:

```
R1-rim M00_001_01_Tops_01_CLOTH  [0,0,0] -> [0.45,0.45,0.45]   grey
R1-rim M00_001_01_Body_00_SKIN   [0,0,0] -> [0.45,0.45,0.45]   grey
R1-rim F00_000_Hair_00_HAIR_02   [0,0,0] -> [0.28,0.42,0.36]   tinted (litFactor not white)
```

Grey rim light adds achromatic energy and measurably dilutes colour. Not severe enough to make
repair a regression — the human judged repair ON better in spike 002 — but it is points left on
the table. **Follow-up: derive the rim tint from the base texture's average colour (or from the
key light), not from `litFactor`.**

### Signal for the real build

- Default `toneMapping` to `THREE.CineonToneMapping`; keep the existing `toneMapping` prop
  override, and keep `Neutral` documented as the max-saturation alternative.
- Do **not** offer `NoToneMapping` as a "flat look" option — it is a desaturator, not a bypass.
- Expect to make up the lost contrast in the light rig, which is the next round's work anyway.
- Fix R1's rim tint derivation before the pass graduates into `packages/react`.
