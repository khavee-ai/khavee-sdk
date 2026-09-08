# Phase 15 Research — MToon Material Repair & Tone Mapping

**Source:** Spikes 001-003 (`.planning/spikes/`), all VALIDATED and committed
(`6f48140`, `7ca3648`, `31d2d75`).

> This document replaces a `gsd-phase-researcher` pass. Every number below was **measured
> against the repo's real `.vrm` assets**, and the working code already exists and has been
> human-verified in a browser at `/mtoon-spike`. Doc research would be strictly weaker.

## 1. Verified library facts (`@pixiv/three-vrm@3.4.2`, `three@0.180.0`)

- **One preset covers every model.** `VRMLoaderPlugin` (registered plainly at
  `packages/react/src/VRMAvatar.tsx:84`) internally runs `VRMMaterialsV0CompatPlugin` +
  `MToonMaterialLoaderPlugin`, so VRM 0.x and VRM 1.0 both arrive as `MToonMaterial` with
  VRM 1.0 property names. No per-spec branching is needed.
- **File values ≠ runtime values.** v0compat rewrites them:
  ```
  shadingToonyFactor = lerp(_ShadeToony, 1, 0.5 + 0.5 * _ShadeShift)
  shadingShiftFactor = -_ShadeShift - (1 - shadingToonyFactor)
  giEqualizationFactor = 1 - _IndirectLightIntensity
  outlineWidthFactor   = 0.01 * _OutlineWidth        // v0 cm -> v1 m
  ```
  **All detection thresholds must be written against runtime values.** Two rules drafted from
  file values were proven dead or dangerous (§3).
- **Tone mapping does reach MToon.** Its fragment shader includes `<tonemapping_fragment>`.
- **Rim is additive after lighting** (MToon spec), so it sits in the brightest part of the
  image — the range a filmic curve compresses hardest. Rim work and tone-curve work interact.
- **`rimLightingMixFactor` is not an on/off switch.** Per spec it blends *emission* (0) vs
  *lit* (1) rim; `0` makes rim **more** visible. Rim is killed by a **black
  `parametricRimColorFactor`**.
- **Headless loading works** (contradicts `11-11-SUMMARY.md`): the "full VRMLoaderPlugin
  crashes in Node" claim is only true for **textures**. Register a plugin before
  `VRMLoaderPlugin` returning image-less `new THREE.Texture()` from `loadTexture`,
  `loadTextureImage` and `assignTexture`, plus `globalThis.self ??= globalThis`. This is what
  makes TEST-01 possible. Caveat: texture-driven material values are invisible under the stub.

## 2. Measured state of the real assets (spike 001)

Rule fire counts, materials affected / total MToon:

| Rule | `male.vrm` | `3636451243928341470.vrm` | `262410318834873893.vrm` | `amongus.vrm` |
|---|---|---|---|---|
| rim colour ≈ black | **19/19** | 9/21 | **18/18** | 1/2 |
| fresnel power > 20 | 0/19 | 0/21 | **18/18** | 0/2 |
| toony < 0.3 | **14/19** | 4/21 | 0/18 | 0/2 |
| shift >= 0.5 (fully lit) | **5/19** | 0/21 | 0/18 | 0/2 |
| toony outside 0-1 | 1/19 | 0/21 | 0/18 | 0/2 |
| shade ≈ lit | 7/19 | 7/21 | 7/18 | 1/2 |

Every VRM avatar in the repo is MToon; only `happy.glb` is plain glTF PBR (different shading
path, out of scope).

## 3. Rules — the validated set

| Rule | Trigger (runtime) | Action |
|---|---|---|
| R5 | `shadingToonyFactor` outside `[0,1]` | clamp (run first, normalises input to R3) |
| R4 | `shadingShiftFactor >= 0.5` | set to `0` |
| R3 | `shadingToonyFactor < 0.3` | set to `0.75` |
| R2 | `parametricRimFresnelPowerFactor > 20` | set to `5` |
| R1 | `parametricRimColorFactor` ≈ black **and** no `rimMultiplyTexture` | inject rim colour **and** raise fresnel power to 5 when it is below 2 |

**Deleted, with evidence:**
- `shadingShiftFactor < -0.5` — **0 hits across all 78 materials.** Drafted from file values;
  `male.vrm`'s raw `_ShadeShift = -1` becomes `-0.15` or `+1` at runtime.
- `shadeColorFactor ≈ litFactor -> inject cool shade` — **7/7 hits on `male.vrm` are eyes,
  highlights, lashes, eyelines and brows**, where flat shading is deliberate anime authoring.
  Repairing them paints shadows across irises.

**Face-detail exclusion (MTOON-02)** — skip any material matching, before any rule runs:
```
/eye|iris|highlight|lash|eyeline|brow|mouth|tooth|teeth|tongue|face_?e|shadow/i
```
Deliberately does **not** match face SKIN (`..._Face_00_SKIN`), which should be repaired.

**Two traps that make a "working" pass a regression:**
1. **Rim colour alone is not enough.** `male.vrm` ships `parametricRimFresnelPowerFactor = 1`
   on every material; at power 1 the Fresnel term covers the whole surface, so a rim colour
   reads as a full-body wash rather than an edge. R1 must raise fresnel too.
2. **Rim tint must not come from `litFactor` (MTOON-03, the open bug).** VRoid models leave
   `litFactor` white and keep the real colour in the base **texture**, so deriving the rim from
   `m.color` emits grey:
   ```
   R1-rim M00_001_01_Tops_01_CLOTH [0,0,0] -> [0.45,0.45,0.45]   grey
   R1-rim F00_000_Hair_00_HAIR_02  [0,0,0] -> [0.28,0.42,0.36]   tinted (litFactor not white)
   ```
   Measured effect: repair ON **lowers** mean saturation on every tone curve (Neutral
   0.6526 -> 0.6111, ACES 0.3750 -> 0.3460). Derive the tint from the base texture's average
   colour (or the key light) instead. Success criterion 4 is this bug.

## 4. Tone mapping (spike 003)

Measured on `male.vrm`, exposure 1.00, avatar pixels only (alpha-masked):

| curve | meanSat (OFF) | meanSat (ON) | meanVal (OFF) | spread (OFF) |
|---|---|---|---|---|
| Neutral | **0.6526** | 0.6111 | 0.3123 | 0.2662 |
| **Cineon** *(chosen)* | 0.5066 | 0.4665 | 0.3248 | 0.2898 |
| ACESFilmic *(today)* | 0.3750 | 0.3460 | 0.3307 | **0.3041** |
| AgX | 0.3264 | 0.2987 | 0.3381 | 0.2454 |
| None | 0.2753 | 0.2550 | 0.3569 | 0.2552 |
| Reinhard | 0.2563 | 0.2365 | 0.3141 | 0.2063 |

- **Cineon is the chosen default** (TONE-01): +35% saturation over ACES for ~0.014 of lost
  contrast, the best saturation-per-unit-contrast on the board. Human pick, metric-supported.
- **Do not offer `NoToneMapping` as a "flat/authored colour" option.** Measured second-lowest
  saturation of six: with no curve, out-of-range values clip per channel, pushing channels
  toward equality and destroying saturation on the brightest surfaces.
- ACES wins only on contrast. That loss is recovered from the light rig and
  `shadingToonyFactor`, not from the tone curve — and the light rig is the *next* round's work.

## 5. Working code to graduate

Throwaway spike code, human-verified in a browser, to be promoted into
`packages/react/src/utils/renderQuality.tsx`:

- `apps/playground/src/app/mtoon-spike/repairMToon.ts` — rules R1-R5, the face-detail
  classifier, and `snapshotMToon` / `restoreMToon` (what makes `materialPreset="off"` work at
  runtime without a reload — success criterion 5).
- `apps/playground/src/app/mtoon-spike/measureSaturation.ts` — the saturation metric behind
  success criterion 4.
- `.planning/spikes/002-mtoon-repair-pass/verify-repair.mjs` — the three invariants
  (no face-detail modified, deleted rules cannot fire, restore is exact), the seed for TEST-01.

## 6. Open questions for the planner

- Where `debugShading` (MTOON-05) hooks in: `MToonMaterialLoaderPlugin` takes `debugMode` as a
  **load-time** option, but `MToonMaterial` also exposes a `debugMode` setter — a runtime prop
  toggle should use the latter to avoid a reload.
- Whether `"anime-premium"` (MTOON-04) ships in this phase or is deferred; only `"off"` and
  `"repair"` have spike evidence behind them.
- Whether the spike page under `apps/playground/src/app/mtoon-spike/` is deleted, or kept and
  repointed at the real SDK API as a regression fixture.
