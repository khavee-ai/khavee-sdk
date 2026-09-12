# Spike Manifest

## Idea

Lift the visual quality of KHAVEE's VRM avatars toward the tier set by consumer companion
apps like Animates (Animation Inc) — without touching the character assets or the animation
system. The lever under test is the **MToon material layer**: every VRM avatar the SDK ships
is MToon-shaded, yet the SDK has never read or written a single MToon parameter, and the
renderer forces `ACESFilmicToneMapping` (a PBR/film curve) over toon-shaded output.

The hypothesis: a large share of the perceived quality gap is not art budget but
**broken/unset authored MToon values** (rim light disabled three ways over, `shadeColor`
set equal to lit color so surfaces render flat) compounded by a tone-mapping curve that
desaturates exactly the colors toon shading depends on.

## Requirements

Design decisions that emerged during spiking. Non-negotiable for the real build.

- Must be a **repair pass, not an override pass** — well-authored models (real rim colors,
  sane fresnel power) must render identically with the feature on. Proven per-spike against
  `3636451243928341470.vrm`.
- Detection thresholds must be defined against **runtime** MToon values (post-`VRMMaterialsV0CompatPlugin`
  conversion), never against raw values read from the `.vrm` file.
- Default renderer tone mapping becomes **`THREE.CineonToneMapping`** (human pick over the
  metric-topping `Neutral`: +35% saturation vs ACES for near-zero contrast loss). `Neutral`
  stays documented as the max-saturation alternative. (from 003)
- Existing `toneMapping` prop on `VRMAvatar` must keep overriding whatever new default is chosen.
- **`NoToneMapping` must not be offered as a "flat/authored colour" option.** Measured
  second-lowest saturation of six curves — with no curve, out-of-range values clip per channel
  and push channels toward equality, destroying saturation on exactly the brightest surfaces.
  (from 003)
- R1's rim tint must be derived from the base **texture's** average colour (or the key light),
  not from `litFactor` — VRoid models leave `litFactor` white, so the current derivation emits a
  grey rim that measurably dilutes saturation. Must be fixed before the pass graduates. (from 003)
- **The repair pass must never touch face-detail materials** (eyes, irises, highlights,
  eyelashes, eyelines, brows, mouth). Flat/unshaded authoring on these is a deliberate anime
  convention, not a defect — spike 001 found 7/7 of `male.vrm`'s "flat" materials are exactly
  these. (from 001)
- Injecting a rim colour must also raise `parametricRimFresnelPowerFactor` when it is below ~2 —
  at power 1 the Fresnel term covers the whole surface and a rim colour reads as a full-body
  wash, not an edge. Colour alone is a regression. (from 002)
- `materialPreset="repair"` is safe as a **default-on** setting — proven non-regressive against a
  well-authored model that the pass does modify. (from 002)
- A rule must skip a slot when the corresponding MToon multiply texture is present
  (`rimMultiplyTexture`, `shadeMultiplyTexture`, `shadingShiftTexture`) — factor-only
  inspection cannot see texture-driven values. (from 001)

- **Every measurement in spikes 001-003 was taken under khavee-app's PRODUCTION lighting**
  (002 copied it verbatim; 003 held it fixed). Phase 16 replaces that lighting, so the
  `0.3041` ACESFilmic contrast figure cannot be used as a Phase 16 gate without being
  re-measured under the new rig. Re-baseline before comparing. (found during 004-007 planning)
- The `mtoon-spike` playground page is **no longer a throwaway spike page** — Phase 15
  graduated it into a permanent regression fixture. Later spikes must not modify it; they get
  their own page. (found during 004-007 planning)

- **DOF focus must be derived from the subject's live camera distance, never a constant.** A
  fixed `worldFocusDistance` stops matching the subject the moment the camera dollies, and the
  subject then blurs along with the background. Phase 17 adds camera moves by design, so this is
  structural, not incidental. (from 004)
- **Background fit must be a choice, not hard-coded `cover`.** Against a 16:9 viewport, `cover`
  keeps 100% of a 16:9 image but only 56% of a square and **31.6% of a 9:16 phone photo** — the
  most likely customer upload. Needs at least `cover`/`contain`, plausibly a focal point. (from 004)
- **An in-canvas backdrop must use `meshBasicMaterial` with `toneMapped={false}` and
  `ClampToEdgeWrapping`.** It is an image, not a lit surface: lighting it breaks its match to the
  source, tone-mapping it double-applies Phase 15's curve, and the default wrap mode makes the
  cropped edge reappear on the opposite side. (from 004)
- **Frame timings must never be gathered through browser automation.** Chrome throttles
  `requestAnimationFrame` to ~1Hz in hidden tabs, which produced a convincing but entirely false
  "2570ms/frame" reading. Performance numbers require a visible, focused tab. (from 004)

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|------|------|-----------|---------|------|
| 001 | mtoon-runtime-audit | standard | Given real .vrm assets loaded through the SDK's own loader path, when every MToonMaterial's runtime properties are dumped, then the actual post-v0compat values are known and the proposed detection thresholds are confirmed or refuted | **VALIDATED** — 2 draft rules deleted, 2 new rules found | mtoon, vrm, diagnostics, v0compat |
| 002 | mtoon-repair-pass | standard | Given a badly-authored and a well-authored VRM side by side, when the repair pass is toggled, then the bad model visibly improves and the good model does not regress | **VALIDATED** — human-confirmed both criteria; rim injection needs a fresnel fix too | mtoon, rendering, repair, non-regression |
| 003 | tonemapping-toon | standard | Given the same MToon avatar, when renderer tone mapping is switched live across six curves, then a curve is found that preserves toon saturation better than the current ACES default | **VALIDATED** — Cineon chosen (+35% sat, ~equal contrast); NoToneMapping refuted as a "flat look" option | mtoon, tonemapping, rendering, measurement |
| 004 | backdrop-plane-dof | standard | Given real customer background images at several aspect ratios, when a backdrop plane is placed in-canvas behind the avatar and DOF is enabled, then `background-size: cover` equivalence holds across resizes and DOF separates background from subject without blurring the avatar | **VALIDATED** — cover holds; DOF works but ONLY with subject-tracking focus; `cover` keeps just 31.6% of a 9:16 upload | lighting, dof, background, composition |
| 005 | lighting-contrast-rebaseline | standard | Given a prototype three-point rig with a rim light, when contrast and saturation are re-measured under it for both ACESFilmic and Cineon, then the correct Phase 16 contrast gate is known (superseding the 0.3041 figure measured under old lighting) | PENDING | lighting, measurement, tonemapping, rebaseline |
| 006 | outline-draw-cost | standard | Given `male.vrm`'s 19 materials, when MToon outlines are enabled, then the real frame-time and draw-call cost is measured on a representative device rather than assumed | PENDING | mtoon, outlines, performance |
| 007 | rim-from-background | standard | Given both a flat COLOR background and an uploaded IMAGE background, when the rim tint is derived from it, then the result reads as belonging to the same scene rather than merely measuring as more saturated | PENDING | lighting, rim, background, colour |
