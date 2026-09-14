# Phase 16: Lighting, Shadows & Post-Processing - Context

**Gathered:** 2026-09-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the avatar read as a lit subject standing in a scene, rather than a flat cut-out
composited onto a background. Delivers: a three-point light rig with a rim/back light,
soft contact shadows, an opt-in post-processing chain, an opt-in in-canvas backdrop that
makes depth-of-field meaningful, and opt-in MToon outlines.

Phase 15 deliberately traded ~0.014 of contrast (ACESFilmic -> Cineon) on the explicit
assumption that **this** phase returns it from lighting rather than from the tone curve.
That debt is this phase's to repay, and it is measurable.

</domain>

<decisions>
## Implementation Decisions

### Light rig and its API

- **D-01:** The new rig must be **configurable**, not fixed. The driving reason is concrete:
  production (`khavee-app`'s `PreviewModel.tsx`) currently sets `autoLighting={false}` and
  hand-rolls its own `ambientLight` + an untuned `directionalLight position={[10,10,5]}
  castShadow` with no shadow-map tuning at all — exactly the configuration `AvatarLightRig`'s
  own comments warn produces shadow acne. Improving the rig without making it configurable
  would change nothing a customer sees.
- **D-02:** Config arrives via a **new, separate `lighting` prop** on `VRMAvatar`, e.g.
  `lighting={{ ambient: 0.6, key: 1.2, rim: 0.8 }}`. `autoLighting` stays a plain boolean —
  not widened to `true | false | LightRigOptions`. Rationale: no breaking change, and it
  matches Phase 15's precedent of adding optional props rather than changing existing prop
  types. Omitting `lighting` must yield the current default behaviour.
- **D-03:** The rig ships as the **new default** (anyone on `autoLighting`'s default `true`
  gets it automatically), consistent with the SDK's zero-config promise and with Phase 15's
  `materialPreset="repair"` default. The rig was already on by default; only its contents change.
- **D-04:** `ambientLightIntensity` is a **customer-facing setting** in khavee-app today. The
  `lighting` prop must be expressive enough that khavee-app can keep that UI control wired to
  it without losing the shadow tuning and rim light.

### Rim light and background colour

- **D-05:** The rim light derives its colour **from the background**, not a fixed white.
  Background is a per-project customer setting (`backgroundType: "COLOR" | "IMAGE"` with
  `backgroundValue` / `backgroundImageUrl`), so the derivation must handle both a flat colour
  and an arbitrary uploaded image, and must update when the customer changes it.

### Background, depth of field, and scope sequencing

- **D-06:** Move the background **into the canvas as a backdrop plane** (opt-in), not
  `scene.background` and not `<Environment>`. Rationale: a plane is the only option that gives
  explicit control of distance, which is what makes DOF blur *tunable* rather than
  all-or-nothing; `scene.background` sits at maximum depth permanently and still carries the
  same aspect-ratio work, so it costs the same and delivers less.
- **D-07:** The in-canvas backdrop is **on by default — but only when a background source is
  actually supplied to the SDK.** "Default on" cannot mean "always render a backdrop", because
  the SDK has no knowledge of a consumer's background unless it is passed in. So the contract is:
  pass a background source and it is composited in-canvas automatically (no extra opt-in flag);
  pass nothing and nothing changes — the canvas stays transparent and the existing CSS-background
  path keeps working untouched.
  - Consequence: this is **not breaking** for any current consumer, including khavee-app, which
    passes no background to the SDK today and will be unaffected until it adopts the new prop.
  - Consequence: D-08's spike becomes **more** important, not less. Because adopting the prop
    immediately gets the in-canvas path with no second flag to hide behind, the aspect/`cover`
    behaviour has to be correct before this ships.
- **D-08:** **Spike first.** Before locking the backdrop + DOF into plans, spike the
  aspect/`cover` behaviour against real customer images at 2-3 different aspect ratios and
  measure the result. This mirrors how Phase 15 was grounded (spikes 001-003 produced its
  entire rule set and thresholds). If the spike shows the aspect/resize handling is not worth
  the cost, fall back to **sampling the background colour only** and defer DOF out of this
  phase — without having wasted the rig or shadow work.

### Shadows

- **D-09:** Add **`ContactShadows` as a separate new component** and keep `ShadowFloor` as-is.
  Not a rename, not a deprecation, not a mode flag inside `ShadowFloor`. Rationale: they are
  genuinely different mechanisms (`ShadowFloor` uses `shadowMaterial` and needs a shadow-casting
  light; drei's `ContactShadows` renders to its own texture and does not), so collapsing them
  into one component with a `mode` prop would misrepresent them. `ShadowFloor` is public API
  that production uses (`<ShadowFloor y={-1.1} />`), so leaving it untouched is also the
  non-breaking choice.

### MToon outlines

- **D-10:** Outlines are **in scope for this phase** and ship **on by default**, as an optional
  prop anyone can turn off. They are deliberately **not** gated behind Phase 13's performance
  tiers.
  - **Accepted risk, stated explicitly:** an outline costs one extra draw pass per material
    (19 materials on `male.vrm`, so roughly 19 -> 38 draw calls), and with no tier system in
    place every consumer inherits that cost without choosing it — including on mobile. The
    roadmap originally deferred outlines behind Phase 13 for exactly this reason. The user was
    told this and chose default-on anyway; recorded here so the decision is traceable rather
    than looking like an oversight later.
  - **Revisit when Phase 13 lands:** once performance tiers exist, outlines should become
    tier-gated (auto-disabled on weak devices) rather than unconditionally on.
  - Planning should treat "measure the actual frame-time cost of outlines on a representative
    device" as in scope, so the accepted risk is quantified rather than assumed.

### Verification

- **D-11:** Prove the contrast recovery by **measurement, not judgement** — reusing the
  `measureSaturation` harness.

  **REVISED after spike 005.** The original wording set the gate at "contrast >= 0.3041,
  ACESFilmic's pre-Phase-15 baseline". That threshold is **not usable** and must not be planned
  against. Spike 005 found that figure was produced under four conditions this phase does not
  share: a different render path (raw `<primitive>` vs `VRMAvatar`, which adds
  `applyMeshRenderFlags`), a different camera framing (`fov 20 @ z4` vs `fov 50 @ z3` — framing
  decides which body pixels are averaged, so it is a measurement variable), a different ambient
  intensity, and repair OFF at a time when `materialPreset` now defaults to `repair`.

  **The gate is therefore a same-harness comparison, not an absolute number:**
  > The three-point rig must measure contrast **>= the `legacy` rig**, both measured in the same
  > harness, same framing, same `materialPreset`, in the same session.

  Absolute figures may not be carried across harnesses in either direction.

### Claude's Discretion

- Exact light positions, intensities and colour temperatures for key/fill/rim.
- Shape and naming of the `lighting` prop's fields beyond the ambient/key/rim axes named in D-02.
- Whether the post chain's vignette and colour grading ship as separate props or one object.
- How the background colour is sampled (average, dominant, or edge-weighted) — D-05 fixes the
  source, not the algorithm.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 15 foundations this phase builds on
- `.planning/phases/15-mtoon-material-repair-tone-mapping/15-CONTEXT.md` — locked material
  decisions; its "Explicitly out of scope this phase" section is precisely this phase's scope.
- `.planning/phases/15-mtoon-material-repair-tone-mapping/15-SUMMARY.md` files (01-04) — what
  actually shipped, including the `materialPreset` / `debugShading` prop precedent.
- `.planning/spikes/003-tonemapping-toon/README.md` — the measured tone-curve table. Source of
  the 0.3041 ACESFilmic contrast baseline that D-11 sets as this phase's floor.
- `.planning/spikes/002-mtoon-repair-pass/README.md` — the non-regression method (test against a
  well-authored control model, not only a broken one). Worth repeating for lighting.

### Code this phase modifies or must not break
- `packages/react/src/utils/renderQuality.tsx` — `AvatarLightRig`, `ShadowFloor`, `AvatarPostFX`,
  `applyRendererDefaults`. The shadow-map tuning comments in `AvatarLightRig` explain why the
  current values are what they are; do not discard that reasoning when replacing the rig.
- `packages/react/src/VRMAvatar.tsx` — where `autoLighting` is consumed and where the new
  `lighting` prop lands.
- `apps/playground/src/app/mtoon-spike/` — the permanent regression fixture and the
  `measureSaturation` harness D-11 depends on.

### Production consumer (out-of-repo, must keep working)
- `khavee-app` `apps/web/src/components/settings/preview/PreviewModel.tsx` — mounts
  `VRMAvatar` with `autoLighting={false}`, plus `<ShadowFloor y={-1.1} />` and
  `<AvatarPostFX bloom={false} />`. The adoption target for D-01/D-02.
- `khavee-app` `apps/web/src/components/settings/preview/BackgroundPanel.tsx` and
  `apps/web/src/features/project/types.ts` — the `backgroundType: "COLOR" | "IMAGE"` customer
  setting D-05 and D-06 must handle.

### Project-level constraints
- `CLAUDE.md` — repo-wide compatibility constraint (`openai-stt-tts` and every existing
  `VRMAvatar`/`GLBAvatar` consumer must keep working) and vendor-neutrality of public API.
- `.planning/ROADMAP.md` §Phase 16 — the five scope items this phase was chartered with.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `measureSaturation` (`apps/playground/src/app/mtoon-spike/`) — already measures mean HSV
  saturation, value and value-spread over avatar pixels only, on a transparent canvas. D-11
  reuses it directly; no new measurement tooling needed.
- `AvatarPostFX` — already an opt-in `EffectComposer` wrapper with Bloom + SMAA. DOF, vignette
  and grading extend it rather than replacing it.
- `applyMeshRenderFlags` — already forces `castShadow`/`receiveShadow` on every mesh, which is
  what makes hair cast onto shoulders. Relevant to contact-shadow work.

### Established Patterns
- **Optional props, never changed prop types** — Phase 15 added `materialPreset` and
  `debugShading` as new optional props and left existing ones alone. D-02 follows this.
- **Renderer-wide mutation is accepted but documented** — `applyRendererDefaults` mutates the
  Canvas-shared `WebGLRenderer`. Any new renderer-level change inherits that documented side
  effect; it is not new, but it is Canvas-wide.
- **`AvatarPostFX` must be mounted once per Canvas, not per avatar** — an `EffectComposer` takes
  over the whole Canvas render pipeline. Any DOF work inherits this constraint.
- **Spike-then-lock** — Phase 15's rules, thresholds and tone curve all came from spikes with
  measured outcomes, not from design-time reasoning. D-08 applies the same discipline to the
  riskiest unknown here.

### Integration Points
- `VRMAvatar` mounts `AvatarLightRig` when `autoLighting` is true — the seam for D-02/D-03.
- `GLBAvatar` renders plain glTF PBR and deliberately stays on `ACESFilmicToneMapping`. Decide
  explicitly whether the new rig applies to it; do not change it by accident.
- The Canvas in production is transparent (`gl={{ preserveDrawingBuffer }}`, no `alpha: false`)
  and screenshots are captured from it — moving the background in-canvas changes what a
  screenshot contains. Worth confirming during the D-08 spike.

</code_context>

<specifics>
## Specific Ideas

- The user explicitly raised "what if we move the background image into the canvas" unprompted,
  which is what surfaced D-06. The in-canvas backdrop is a wanted capability, not a reluctant
  concession to DOF.
- Outlines: first asked for as "เอามาทำเลย แค่อยากให้มันเป็น optional prop" (in this phase, as a
  prop), then revised to **default on** — the prop stays, but its default value flips. The
  performance consequence was put to the user before they confirmed. See D-10.
- Rim colour from the background was chosen over a plain white rim even though white is the
  cheaper, more conventional three-point choice.

</specifics>

<deferred>
## Deferred Ideas

- **Performance tiers (Phase 13)** — still not started. D-10 ships outlines **default on**
  without them, which is the single largest piece of accepted risk in this phase. When Phase 13
  lands, outlines should become tier-gated so weak devices disable them automatically instead of
  paying ~2x draw calls unconditionally.
- **`<Environment>` / true IBL** — considered and rejected for now (D-06). A flat customer photo
  maps poorly to an environment map; revisit if HDRI backgrounds ever become a supported
  background type.
- **Fallback path if the D-08 spike fails** — sample the background colour only, tint the rim
  from it, and defer DOF to Phase 17 (Camera Direction & Scene Composition), which owns framing
  and is a more natural home for depth staging. Note this fallback got riskier under D-07's
  default-on semantics: there is no opt-in flag to hide an unfinished backdrop behind, so if the
  spike fails the in-canvas path must not ship at all rather than shipping half-done.
- **khavee-app migration to the new rig** — adopting `lighting` and dropping
  `autoLighting={false}` is a separate change in a separate repo, and interacts with the pending
  avatar-reimplementation work already planned there. Not this phase's deliverable.

</deferred>

---

*Phase: 16-lighting-shadows-post-processing*
*Context gathered: 2026-09-13*
