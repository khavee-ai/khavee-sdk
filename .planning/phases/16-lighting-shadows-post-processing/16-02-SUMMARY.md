---
phase: 16-lighting-shadows-post-processing
plan: 02
subsystem: rendering
tags: [lighting, shadows, render-quality, three-point-rig, contact-shadows]
dependency_graph:
  requires: [15-03]
  provides: [three-point-rig, lighting-prop, contact-shadows]
  affects: [VRMAvatar, GLBAvatar, consumer-lighting-config]
tech_stack:
  added: [ContactShadows-from-drei]
  patterns: [three-point-lighting, configurable-rig-options, avatar-scaled-defaults]
key_files:
  created: []
  modified:
    - packages/react/src/utils/renderQuality.tsx
    - packages/react/src/VRMAvatar.tsx
    - packages/react/src/GLBAvatar.tsx
    - packages/react/src/index.ts
decisions:
  - Ambient intensity drops from 0.6 to 0.32 by default (every consumer on autoLighting sees this change)
  - Rim light uses static cool white #bcd4ff (plan 16-04 will derive from background)
  - Shadow mapSize and ContactShadows resolution clamped (256-4096, 128-2048) to prevent GPU allocation failure
  - Bare number shorthand for intensity (lighting={{ ambient: 0.6 }}) to match beginner DX constraint
metrics:
  duration: ~45min
  tasks_completed: 3
  files_modified: 4
  lines_added: 283
  lines_removed: 25
  tests_added: 0
  completed_date: 2026-09-14
---

# Phase 16 Plan 02: Three-Point Light Rig & Contact Shadows Summary

Three-point rig (warm key, cool fill, cool rim) with configurable `lighting` prop on both avatar components, plus `AvatarContactShadows` as a new exported component alongside `ShadowFloor`.

## What Was Built

### Task 1: Rewrite AvatarLightRig as Configurable Three-Point Rig

**Completed:** packages/react/src/utils/renderQuality.tsx

Replaced the zero-argument `AvatarLightRig` (ambient 0.6 + one directional) with a configurable three-point rig taking an optional `options?: LightRigOptions` prop. Added new section-divider comment block introducing the lighting types:

- **LightSpec**: one light's parameters (intensity, color, position)
- **LightSetting**: accepts `number | LightSpec` (bare number = intensity shorthand)
- **ShadowOptions**: shadow-map tuning (intensity, mapSize, normalBias, radius)
- **LightRigOptions**: per-axis configuration (ambient, key, fill, rim, shadow)
- **DEFAULT_LIGHT_RIG**: spike-005 prototype values (ambient 0.32, key 1.35 #fff4e6 at [2,4,3], fill 0.45 #cfe0ff at [-3,1.5,2], rim 1.6 #bcd4ff at [-1.5,3,-4], shadow 0.6 intensity / 2048 mapSize / 0.02 normalBias / 4 radius)

Added private `resolveLight(setting, fallback)` helper that normalizes bare numbers into `{ intensity }` and fills unset fields from the fallback, used once per axis so a partial `lighting` object overrides only named axes.

Renders four lights:
1. `ambientLight` from resolved `ambient` (intensity + color only; position deliberately unused, documented in comment)
2. KEY `directionalLight` with `castShadow`, carrying the full shadow-camera bounds + shadow-mapSize/normalBias/radius/intensity from resolved `shadow` options (shadow-tuning comment block carried across verbatim from the old rig)
3. FILL `directionalLight`, no `castShadow` (comment explains why a second shadow-caster is wrong — fights the key)
4. RIM/BACK `directionalLight`, no `castShadow`, positioned behind/above

Updated function JSDoc to state: three-point rig, default for both avatar components, ambient intentionally lower than previous 0.6, static cool-white rim (plan 16-04 will derive from background), includes `@example` showing `lighting={{ ambient: 0.6 }}` D-04 adoption shape.

Did not touch `ShadowFloor`, `applyRendererDefaults`, `applyMeshRenderFlags`, `resolveAnisotropy`, `applySmoothShading`, or `AvatarPostFX`.

**Verification:**
- `tsc` clean
- 3 non-comment `directionalLight` elements exist (key, fill, rim) plus 1 `ambientLight`
- Exactly 1 non-comment `shadowMaterial` remains (ShadowFloor untouched)
- `<AvatarLightRig />` with no props still type-checks

### Task 2: Add lighting Prop to VRMAvatar and GLBAvatar

**Completed:** packages/react/src/VRMAvatar.tsx, packages/react/src/GLBAvatar.tsx

Extended `./utils/renderQuality` import in both files to include `type LightRigOptions`.

Added `lighting?: LightRigOptions;` to both `VRMAvatarProps` and `GLBAvatarProps` interfaces with JSDoc block stating: configures the rig `autoLighting` mounts; omitting yields documented defaults; bare number on any axis is shorthand for intensity; no effect when `autoLighting={false}`. Includes `lighting={{ ambient: 0.6 }}` example.

Added `lighting` to destructured parameter list in both components with no default value (`undefined` signals fallback to `DEFAULT_LIGHT_RIG`).

Added `@param lighting - ...` line to each component's JSDoc, positioned next to existing `@param autoLighting`.

Changed render line in both files to `{autoLighting && <AvatarLightRig options={lighting} />}`.

Did not change `autoLighting` type (still `boolean`), its default, or any other existing prop. Did not change tone-mapping defaults (VRMAvatar stays Cineon, GLBAvatar stays ACESFilmic per Phase 15 TONE-01 split, which D-12 explicitly does not disturb).

**Verification:**
- `tsc` clean
- Both files declare `lighting?: LightRigOptions` exactly once
- Both mount `<AvatarLightRig options={lighting} />`
- `autoLighting` still `boolean` in both
- `GLBAvatar` still resolves to `ACESFilmicToneMapping`

### Task 3: Add AvatarContactShadows and Export New Public Surface

**Completed:** packages/react/src/utils/renderQuality.tsx, packages/react/src/index.ts

Imported `ContactShadows` from `@react-three/drei` (already a declared ^10.7.6 dependency).

Added `AvatarContactShadowsProps` interface and `AvatarContactShadows` component in a new section-divider block placed directly after `ShadowFloor`. Thin wrapper supplying avatar-scaled defaults: `y=0` (mapped to drei's `position`), `opacity=0.6`, `blur=2.5`, `scale=4`, `resolution=512` (clamped 128-2048 per T-16-05), `far=2`, `color="#000000"`, `frames=Infinity`. Passes through to drei's `ContactShadows` with `position={[0, y, 0]}` and `rotation={[-Math.PI / 2, 0, 0]}`.

Component JSDoc carries three facts: (a) needs no light (renders `MeshDepthMaterial` into own render target), (b) complementary to `ShadowFloor`, not a replacement (mounting both is valid), (c) `frames` is the cost lever (default `Infinity` = continuous per-frame depth render + blur, accepted because VRM avatars never stop moving; finite value produces visibly stale shadow per RESEARCH Pitfall 3).

In `packages/react/src/index.ts`, added `AvatarContactShadows` and `DEFAULT_LIGHT_RIG` to value exports from `./utils/renderQuality`, and `AvatarContactShadowsProps`, `LightRigOptions`, `LightSpec`, `LightSetting`, `ShadowOptions` to type exports. Did not remove or reorder any existing export.

**Verification:**
- `tsc` clean
- Barrel check: `AvatarContactShadows`, `AvatarContactShadowsProps`, `DEFAULT_LIGHT_RIG`, `LightRigOptions`, `LightSpec`, `LightSetting`, `ShadowOptions` all exported
- All pre-existing exports (`AvatarPostFX`, `ShadowFloor`, `ShadowFloorProps`, `repairMToonMaterials`, `setMToonDebugMode`, `VRMAvatar`, `GLBAvatar`) still present

## Deviations from Plan

None — plan executed exactly as written. No auto-fix rules triggered, no blocking issues encountered, no architectural questions surfaced.

## Downstream-Visible Changes

**Ambient light intensity drops from 0.6 to 0.32 for every consumer using the default `autoLighting={true}`.**

This is the point — ambient is omnidirectional flat fill and is what eats contrast. Phase 15 traded ~0.014 contrast away (via tone curve) expecting Phase 16 to return it through directional lighting, not through brighter flat fill. The lower ambient is intentional and documented in `DEFAULT_LIGHT_RIG`'s JSDoc.

**Escape hatch:** `lighting={{ ambient: 0.6 }}` keeps every other axis at its default (tuned shadow, fill, rim) while raising ambient to the previous value. This is the exact adoption shape documented in D-04 and is what khavee-app will use to wire its existing customer-facing `ambientLightIntensity` control.

This change is analogous to Phase 15's Cineon tone-mapping default (also a downstream-visible default shift that traded one rendering attribute for another, with an explicit opt-out documented).

## Success Criteria

- ✓ LIGHT-01: `AvatarLightRig` renders four lights (ambient, key, fill, rim) and is the default for both avatar components via their unchanged `autoLighting` default of `true`
- ✓ LIGHT-02: `lighting?: LightRigOptions` exists on both components; `autoLighting` is still `boolean`; omitting `lighting` compiles and yields `DEFAULT_LIGHT_RIG`
- ✓ D-04: `lighting={{ ambient: n }}` is documented with an `@example` and keeps the tuned shadow, fill and rim by falling back to defaults on every unset axis
- ✓ SHADOW-01: `AvatarContactShadows` is exported; `ShadowFloor` is unchanged and still exported
- ✓ No existing prop type or export was changed or removed

## Threat Flags

None. All security-relevant surface identified in the plan's threat model was mitigated:

- **T-16-04 (lighting.shadow.mapSize DoS):** Clamped 256-4096 in `resolveLight`'s shadow branch; documented in prop JSDoc. Out-of-range request is clamped, not thrown.
- **T-16-05 (AvatarContactShadows.resolution DoS):** Clamped 128-2048 in component body; documented in prop JSDoc.
- **T-16-06 (rig lights affecting consumer meshes):** Accepted per threat register — pre-existing behavior of shipped rig, opt-out via `autoLighting={false}`.
- **T-16-07 (lighting.*.color string spoofing):** Accepted — colour strings handed to three.js `Color` parser, which ignores unparseable input; no injection surface.
- **T-16-SC (npm/pnpm installs tampering):** No new dependencies; `@react-three/drei` ^10.7.6 already declared and used elsewhere in package.

## Known Stubs

None. No hardcoded empty values, placeholder text, or unwired data sources were introduced. The three-point rig is fully functional with real measured defaults from spike 005. `AvatarContactShadows` is a thin wrapper over drei's `ContactShadows` with all props wired through.

## Testing

### Automated
- `pnpm --filter @khaveeai/react build` — clean `tsc` across the package
- Phase 15's `pnpm --filter @khaveeai/react test` suite would stay green (this plan touched no tested module — `utils/renderQuality.tsx` has no committed test file, and VRMAvatar/GLBAvatar changes are purely additive props)

### Manual
Not performed (per plan's `<verification>` block: no playground build required here — adoption of the new props happens in plan 16-06).

## Dependencies

### Completed
- Phase 15 (MToon Material Repair & Tone Mapping) — provides the Cineon tone-mapping default this rig's ambient reduction is predicated on

### Provides
- Three-point light rig as default for both avatar components
- `lighting` prop for consumer override of rig axes
- `AvatarContactShadows` for soft contact-shadow rendering
- Public lighting types (`LightRigOptions`, `LightSpec`, `ShadowOptions`)

### Blocks
- Plan 16-04 (background-derived rim tint) — depends on `lighting.rim.color` override path established here
- Plan 16-06 (playground adoption + human measurement checkpoint) — depends on the `lighting` prop and `AvatarContactShadows` export

## Commits

**feat(16-02): add three-point light rig, lighting prop, and AvatarContactShadows** — `8a59a11`
- Rewrite AvatarLightRig as configurable three-point rig (ambient, key, fill, rim)
- Add LightRigOptions, LightSpec, ShadowOptions types + DEFAULT_LIGHT_RIG with spike-005 values
- Add `lighting` prop to both VRMAvatar and GLBAvatar
- Add AvatarContactShadows component wrapping drei's ContactShadows
- Export new lighting types and AvatarContactShadows from package barrel
- Ambient drops from 0.6 to 0.32 (Phase 15 contrast repayment)

## Performance Impact

**Rendering cost:** Three lights instead of two (added fill + rim). Negligible per-frame cost (directional lights are cheap once shadow-map is rendered). Key light's shadow-map settings unchanged from previous rig (2048x2048, still one shadow-caster).

**`AvatarContactShadows` cost:** At default `frames=Infinity`, performs one full-scene depth render + two blur passes every frame. This is continuous per-frame overhead for as long as the component is mounted. Accepted and documented (RESEARCH Pitfall 3) — the alternative (finite `frames`) produces visibly stale shadows on avatars that never stop moving (breathing, spring bones). Consumers can opt out by not mounting it, or tune `frames` lower if their avatar is truly static.

## Next Steps

1. **Plan 16-04:** Add background-derived rim tint logic (overrides `lighting.rim.color` based on scene background)
2. **Plan 16-06:** Adopt new `lighting` prop in playground, human measurement checkpoint (verify contrast/saturation meets D-11 gate under the shipped rig, not the spike prototype)
3. **khavee-app adoption (out-of-repo):** Wire existing `ambientLightIntensity` customer control to `lighting={{ ambient: value }}` to preserve customer-facing slider while upgrading to the new rig

## Self-Check: PASSED

All claimed files exist:
- ✓ packages/react/src/utils/renderQuality.tsx (modified)
- ✓ packages/react/src/VRMAvatar.tsx (modified)
- ✓ packages/react/src/GLBAvatar.tsx (modified)
- ✓ packages/react/src/index.ts (modified)

Commit exists:
- ✓ `8a59a11` present in `git log --oneline --all`
