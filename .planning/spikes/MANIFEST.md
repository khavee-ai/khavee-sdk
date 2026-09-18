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

- **A measurement is only comparable within the harness that produced it.** Spike 003's
  `0.3041` contrast figure cannot be used as a Phase 16 gate: it was measured on a different
  render path (raw `<primitive>` vs `VRMAvatar`), a different framing (`fov 20 @ z4` vs
  `fov 50 @ z3`), a different ambient, and with repair OFF before repair became the default.
  Gates must be expressed as **same-harness deltas** ("rig A >= rig B, measured together"),
  never as absolute thresholds carried across spikes. (from 005)
- **Pixel measurement, like frame timing, requires a visible focused tab.** In an automated
  (hidden) tab `measureCanvas` returns null on every sample while screenshots of the same tab
  show a fully rendered scene — rAF is throttled and the WebGL buffer is empty when sampled.
  Screenshot-based *visual* comparison still works, because taking a screenshot forces a paint.
  (from 005, same root cause as 004)
- **Every measurement harness needs a reproduction check built into it.** The only reason the
  above was caught is that the sweep included a row whose expected value was already known from
  a prior spike. Without that row the numbers looked entirely plausible. (from 005)

- **Derive the rim tint with a saturation-weighted upper-region sample, never a plain mean.**
  Measured on adversarial fixtures: a plain mean turns a grey wall + red neon into muddy mauve
  (sat 0.19), reproducing MTOON-03's grey-rim defect one level up; `dominant` returns grey there
  and picks the dark ground rather than the sky on a sky/ground photo. Upper-region wins on
  measured evidence and is the only option with a physical justification — a rim light comes from
  behind and above. (from 007)
- **A neutral background must produce a neutral rim, and that guarantee needs its own test.**
  All four derivations currently hold it, but Phase 15's WR-02 showed this exact class of
  guarantee failing silently in shipped code. (from 007)
- **Known limit, to document rather than tune away:** a background split evenly between two
  opposing saturated hues defeats every derivation — no single rim colour is right for it. (from 007)

- **three-vrm only generates an outline when the asset authors a width above 0, and the drawn
  outline is a clone with its own uniforms.** `male.vrm` sets an outline mode on 6 materials but
  width 0, so it has no outline at all; writing the surface material's width changes nothing on
  screen. An outline toggle must act on the clone. Spike 001's 18/10 count for
  `262410318834873893.vrm` included the clones themselves (13 surfaces, 5 outlined). (from 16-06)
- **Anything mounted inside `VRMAvatar`'s group inherits its 180° default rotation.** A light rig
  placed there lit VRM0 models from behind and put the rim on the face; contrast then tracked rim
  intensity rather than key shape. VRM1 assets face the other way (review WR-06, still open).
  (from 16-06)
- **DepthOfField's `worldFocusDistance` is view-space depth, not straight-line distance.** Feeding
  `distanceTo` focuses an off-axis subject behind itself. (from 16-06)

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|------|------|-----------|---------|------|
| 001 | mtoon-runtime-audit | standard | Given real .vrm assets loaded through the SDK's own loader path, when every MToonMaterial's runtime properties are dumped, then the actual post-v0compat values are known and the proposed detection thresholds are confirmed or refuted | **VALIDATED** — 2 draft rules deleted, 2 new rules found | mtoon, vrm, diagnostics, v0compat |
| 002 | mtoon-repair-pass | standard | Given a badly-authored and a well-authored VRM side by side, when the repair pass is toggled, then the bad model visibly improves and the good model does not regress | **VALIDATED** — human-confirmed both criteria; rim injection needs a fresnel fix too | mtoon, rendering, repair, non-regression |
| 003 | tonemapping-toon | standard | Given the same MToon avatar, when renderer tone mapping is switched live across six curves, then a curve is found that preserves toon saturation better than the current ACES default | **VALIDATED** — Cineon chosen (+35% sat, ~equal contrast); NoToneMapping refuted as a "flat look" option | mtoon, tonemapping, rendering, measurement |
| 004 | backdrop-plane-dof | standard | Given real customer background images at several aspect ratios, when a backdrop plane is placed in-canvas behind the avatar and DOF is enabled, then `background-size: cover` equivalence holds across resizes and DOF separates background from subject without blurring the avatar | **VALIDATED** — cover holds; DOF works but ONLY with subject-tracking focus; `cover` keeps just 31.6% of a 9:16 upload | lighting, dof, background, composition |
| 005 | lighting-contrast-rebaseline | standard | Given a prototype three-point rig with a rim light, when contrast and saturation are re-measured under it for both ACESFilmic and Cineon, then the correct Phase 16 contrast gate is known (superseding the 0.3041 figure measured under old lighting) | **PARTIAL** — gate must become a same-harness delta, not an absolute threshold; 003's number is not portable (4 conditions differ). Numbers themselves still untrusted and withheld | lighting, measurement, tonemapping, rebaseline |
| 006 | outline-draw-cost | standard | Given `male.vrm`'s 19 materials, when MToon outlines are enabled, then the real frame-time and draw-call cost is measured on a representative device rather than assumed | **DISCHARGED by plan 16-06** — `male.vrm` authors no drawable outline (width 0, so three-vrm generates none); with `outlineWidth={0.003}` draw calls go 104 → 200 (+96), and hiding outlines returns them to 104. Frame time unmeasurable on the dev machine: 120 FPS vsync cap in every state | mtoon, outlines, performance |
| 007 | rim-from-background | standard | Given both a flat COLOR background and an uploaded IMAGE background, when the rim tint is derived from it, then the result reads as belonging to the same scene rather than merely measuring as more saturated | **VALIDATED** — ship saturation-weighted upper-region; `mean` reproduces the MTOON-03 grey-rim defect, `dominant` picks the wrong half | lighting, rim, background, colour |
