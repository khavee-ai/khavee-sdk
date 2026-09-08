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
- Existing `toneMapping` prop on `VRMAvatar` must keep overriding whatever new default is chosen.
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

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|------|------|-----------|---------|------|
| 001 | mtoon-runtime-audit | standard | Given real .vrm assets loaded through the SDK's own loader path, when every MToonMaterial's runtime properties are dumped, then the actual post-v0compat values are known and the proposed detection thresholds are confirmed or refuted | **VALIDATED** — 2 draft rules deleted, 2 new rules found | mtoon, vrm, diagnostics, v0compat |
| 002 | mtoon-repair-pass | standard | Given a badly-authored and a well-authored VRM side by side, when the repair pass is toggled, then the bad model visibly improves and the good model does not regress | **VALIDATED** — human-confirmed both criteria; rim injection needs a fresnel fix too | mtoon, rendering, repair, non-regression |
| 003 | tonemapping-toon | standard | Given the same MToon avatar, when renderer tone mapping is switched live across ACES/Neutral/AgX/None, then Neutral preserves toon saturation better than the current ACES default | PENDING | mtoon, tonemapping, rendering |
