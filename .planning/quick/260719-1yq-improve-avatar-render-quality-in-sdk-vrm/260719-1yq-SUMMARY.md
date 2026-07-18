---
status: complete
---

# Quick Task 260719-1yq: Improve Avatar Render Quality in SDK VRM/GLB Avatars — Summary

**Both `VRMAvatar` and `GLBAvatar` now default to production-quality rendering (shadows, anisotropic filtering, ACESFilmic tone mapping + sRGB output, and a scoped light rig) via a new shared `renderQuality.tsx` helper module, with every behavior individually opt-out-able and zero breaking changes to existing consumers.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-07-18T18:30:34Z
- **Completed:** 2026-07-18T18:33:24Z (typecheck/verification), commits shortly after
- **Tasks:** 3/3 completed
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- New `packages/react/src/utils/renderQuality.tsx` shared helper module: `applyMeshRenderFlags`, `applyRendererDefaults`, `resolveAnisotropy`, and `AvatarLightRig`.
- `VRMAvatar` and `GLBAvatar` both gained 5 additive optional props (`castShadow`, `receiveShadow`, `anisotropy`, `toneMapping`, `autoLighting`), all defaulting to "on"/production-quality behavior.
- Mesh shadow flags + resolved anisotropy applied at load time for both formats (VRM: inside the existing async-scene effect; GLB: new effect keyed on `gltf.scene`).
- Renderer tone mapping (`ACESFilmicToneMapping`) + output color space (`SRGBColorSpace`) forced on mount via `useThree()`→`gl`, documented at both the helper and call sites as a deliberate Canvas-global side effect.
- `AvatarLightRig` (ambient + directional light) mounts inside each avatar's own group by default, skippable via `autoLighting={false}`.
- Public barrel export surface (`packages/react/src/index.ts`) untouched — `VRMAvatarProps`/`GLBAvatarProps` remain unexported, as required.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared renderQuality helper module** - `6c8a2eb` (feat)
2. **Task 2: Wire render-quality defaults into VRMAvatar** - `f84b3f2` (feat)
3. **Task 3: Wire render-quality defaults into GLBAvatar** - `6e13422` (feat)

_Note: `tdd="true"` was set on all 3 tasks, but this package (`packages/react`) has no dedicated component test suite per CLAUDE.md — the plan's own `<verification>` section states `tsc --noEmit` is the automated gate for this package, so no RED/GREEN test commits were produced. This matches the plan's explicit verification instructions, not a deviation._

## Files Created/Modified
- `packages/react/src/utils/renderQuality.tsx` - New shared helper module (mesh render flags, renderer defaults, anisotropy resolution, `AvatarLightRig` component)
- `packages/react/src/VRMAvatar.tsx` - Added 5 additive optional props; applies mesh flags in the existing async-scene effect; forces renderer defaults on mount; renders `AvatarLightRig` by default
- `packages/react/src/GLBAvatar.tsx` - Added the same 5 additive optional props; applies mesh flags in a new `gltf.scene`-keyed effect; forces renderer defaults on mount; renders `AvatarLightRig` by default

## Decisions Made
- Followed the plan's interface extraction exactly — no exploration was needed beyond reading the two target files to confirm line-accurate hook points (existing `useEffect` in `VRMAvatar` keyed on `[scene, currentVrm, setVrm]`; new effect in `GLBAvatar` keyed on `gltf.scene`).
- Kept `AvatarLightRig` fragment-only (no wrapping group) since it's rendered as a sibling inside each avatar's own `<group>`, which already carries position/rotation/scale — this keeps the rig spatially scoped without introducing an extra transform node.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Pre-existing `tsc --noEmit -p packages/react/tsconfig.json` errors (12 errors, all `Cannot find module 'vitest'` and related type errors in `*.test.ts` files under `animation/` and `utils/remapMixamoAnimationToVrm.test.ts`) were confirmed pre-existing and out of scope: verified by temporarily removing the new `renderQuality.tsx` file and re-running `tsc` — the identical 12 errors appeared with or without this plan's changes. None of the 3 task files (`renderQuality.tsx`, `VRMAvatar.tsx`, `GLBAvatar.tsx`) appear in the error output at any point.

## User Setup Required

None - no external service configuration required. This is a pure client-side three.js/R3F rendering change with no new packages, network calls, or environment variables.

## Next Phase Readiness
- Both avatar components now ship with sane rendering defaults; any demo page mounting `<Canvas shadows>` will now actually see shadows without further code changes.
- Live/visual verification (does the avatar actually look better in a running demo page) was NOT performed as part of this quick task — this plan's own `<verification>` section scopes the automated gate to `tsc --noEmit` plus manual reasoning about prop additivity, not a live browser check. If a live visual regression check is desired, run one of the existing demo pages (`src/app/openai-avatar-test`, `glb-avatar-test`, `vrm-avatar-test`, `glb`, `generic-demo`, `animation-test`) and confirm shadows/lighting/tone-mapping render as expected, and that pages with hand-rolled lights still look correct (may need `autoLighting={false}`).

---
*Quick task: 260719-1yq*
*Completed: 2026-07-18*

## Self-Check: PASSED

All created/modified files exist on disk and all 3 task commits (`6c8a2eb`, `f84b3f2`, `6e13422`) are present in git history.
