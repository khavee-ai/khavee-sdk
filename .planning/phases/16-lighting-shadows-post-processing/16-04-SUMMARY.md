---
phase: 16-lighting-shadows-post-processing
plan: 04
subsystem: avatar-rendering
tags: [lighting, background, composition, rim-light]
requires: [BG-01, BG-02, LIGHT-03]
provides:
  - in-canvas backdrop plane with cover/contain fit
  - rim light colour derivation from background
  - non-breaking background prop on avatar components
affects: [VRMAvatar, GLBAvatar, AvatarLightRig]
dependency_graph:
  requires:
    - "16-01 (backdropCover.ts, deriveRimColor.ts)"
    - "16-02 (AvatarLightRig, LightRigOptions)"
    - "spike 004 (backdrop plane + DOF validation)"
    - "spike 007 (rim derivation validation)"
  provides:
    - "AvatarBackdrop component"
    - "useBackgroundRimColor hook"
    - "mergeRimColor helper"
    - "background prop on VRMAvatar and GLBAvatar"
  affects:
    - "khavee-app (new CORS requirement on CDN)"
    - "plan 16-03 (DOF now has backdrop distance to target)"
tech_stack:
  added:
    - "@react-three/fiber useThree hook for camera/viewport"
    - "THREE.TextureLoader with crossOrigin"
    - "document.createElement('canvas') for rim sampling"
  patterns:
    - "Fragment return wrapping backdrop + avatar group"
    - "Hook-driven colour derivation with error callback"
    - "Optional onError callback for silent-by-default failures"
key_files:
  created:
    - "packages/react/src/utils/AvatarBackdrop.tsx"
    - "packages/react/src/utils/backgroundRim.ts"
  modified:
    - "packages/react/src/VRMAvatar.tsx"
    - "packages/react/src/GLBAvatar.tsx"
    - "packages/react/src/index.ts"
decisions:
  - "Backdrop renders outside avatar group to avoid inheriting rotation"
  - "COLOR backgrounds skip sampling and return value directly"
  - "Caller-specified rim.color always wins over derived colour"
  - "Failures degrade (report via onError) rather than throw"
  - "Default-on when background supplied, zero-breaking when omitted"
metrics:
  duration: "~25min"
  completed: "2026-09-14T07:52:47Z"
  tasks_completed: 3
  files_created: 2
  files_modified: 3
  commits: 3
  tests_passing: 198
---

# Phase 16 Plan 04: In-Canvas Backdrop & Background-Derived Rim Light — Summary

**One-liner:** In-canvas backdrop plane with cover/contain fit, rim light colour sampled from background (flat COLOR or uploaded IMAGE), non-breaking background prop on both avatar components.

## What Was Built

### Task 1: AvatarBackdrop — The In-Canvas Backdrop Plane

Created `packages/react/src/utils/AvatarBackdrop.tsx` — a component rendering COLOR or IMAGE backgrounds as a plane at finite distance, graduating the validated spike 004 implementation.

**Key behaviors:**
- **COLOR backgrounds:** Render a plane with `meshBasicMaterial color={background.value} toneMapped={false}` sized to fill the frustum at the specified distance (default 6 units).
- **IMAGE backgrounds:** Load texture via `THREE.TextureLoader` with `crossOrigin="anonymous"`, apply `ClampToEdgeWrapping`, compute cover/contain layout via `backdropLayout` from plan 16-01, reject oversized images (>50MP), dispose on URL change/unmount.
- **Viewport-responsive:** Recomputes layout on `size.width`/`size.height` changes to maintain aspect-correct fit across resizes.
- **URL validation:** Allowlist `http:`, `https:`, `blob:`, `data:` schemes; reject invalid/missing schemes and non-`image/` data: URLs before load.
- **Non-throwing:** All failures (scheme rejection, load error, oversized image) report through optional `onError` callback and leave the backdrop unrendered.

**Rationale (from D-06):** A plane at finite distance is the only option that makes depth of field (plan 16-03) tunable — `scene.background` sits at maximum depth permanently with no control knob.

### Task 2: useBackgroundRimColor & mergeRimColor — Derive Rim Colour From Background

Created `packages/react/src/utils/backgroundRim.ts` — a hook deriving rim light colour from a COLOR or IMAGE background, plus a helper merging that colour into a light rig without overriding explicit caller intent.

**useBackgroundRimColor:**
- **COLOR case:** Returns `background.value` directly with no canvas work (spike 007: all derivations agree trivially on a flat colour).
- **IMAGE case:** Loads image (with `crossOrigin="anonymous"`), downsamples to ≤128px long edge (bounded-work mitigation, T-16-12), reads pixels via `getImageData`, derives via `deriveRimColor` (saturation-weighted upper-region mean from plan 16-01), returns hex colour or `undefined` on failure.
- **Failure modes:** URL validation, oversized image, load error, tainted-canvas `SecurityError` (CORS failure) — all normalized with `error instanceof Error ? error : new Error(String(error))` pattern and reported through `onError`.
- **Cancellation guard:** Effect cleanup sets a flag so late-resolving images for previous URLs cannot overwrite current state.
- **Server-side safe:** Guards on `typeof document === "undefined"` to avoid throwing during SSR.

**mergeRimColor:**
- Preserves caller-specified `lighting.rim.color` if present (explicit prop wins).
- For bare numeric `rim` (intensity shorthand), expands to `{ intensity, color: derived }`.
- For undefined `rim`, creates `{ color: derived }`.
- Returns `lighting` unchanged when `derived` is `undefined` (no derivation available).

### Task 3: Wire background Prop Into Both Avatar Components

Updated `packages/react/src/VRMAvatar.tsx`, `packages/react/src/GLBAvatar.tsx`, and `packages/react/src/index.ts`:

**VRMAvatar & GLBAvatar changes:**
- Added `background?: AvatarBackground` and `onBackgroundError?: (error: Error) => void` props with JSDoc documenting CORS requirement, single-mount guidance, and default-on behavior.
- Called `const derivedRim = useBackgroundRimColor(background, onBackgroundError);` at top of component.
- Changed `<AvatarLightRig options={lighting} />` to `options={mergeRimColor(lighting, derivedRim)}`.
- Wrapped return in fragment: `<AvatarBackdrop>` rendered conditionally (`{background && ...}`) before the avatar `<group>`, with comment explaining why backdrop must sit outside the group (VRMAvatar's default `rotation={[0, Math.PI, 0]}` would turn a child backdrop away from camera).

**index.ts barrel exports:**
- Added `export { AvatarBackdrop } from "./utils/AvatarBackdrop";`
- Added `export type { AvatarBackdropProps, AvatarBackground, BackgroundFit } from "./utils/AvatarBackdrop";`

**Verification:** All 198 tests in `packages/react` passing, build clean, manual inspection confirms correct return structure.

## Deviations From Plan

None — plan executed exactly as written. All task invariants verified, all threat mitigations implemented, no auto-fixes or architectural changes needed.

## Requirements Closed

- **BG-01:** `AvatarBackdrop` renders a `meshBasicMaterial` plane with `toneMapped={false}` and `ClampToEdgeWrapping`, sized by `backdropLayout`, re-fitting on resize, supporting `cover` and `contain`.
- **BG-02:** Supplying `background` composites in-canvas with no second flag; omitting it changes nothing for any existing consumer (zero-breaking).
- **LIGHT-03 (wiring half):** The rim light's colour comes from the background when supplied, falls back to rig's static rim when absent, never overrides explicit `lighting.rim.color`.

## Known Constraints & Adoption Impacts

### CORS Requirement (T-16-12, Production Blocker for khavee-app)

**The image host MUST send CORS headers.** Without them:
- `THREE.TextureLoader` refuses the cross-origin texture → backdrop fails to load silently (reports via `onError`).
- `getImageData` throws `SecurityError` → rim derivation fails silently (reports via `onError`).

**Impact on khavee-app:** The platform's CDN/storage must be configured to serve `Access-Control-Allow-Origin` headers for any customer-uploaded background images. If khavee-app's CDN does not send CORS headers today, background images will not work until the CDN is reconfigured. This is **not** a code fix — it is an infrastructure requirement.

### Screenshot Content Change (T-16-17, Accepted)

A Canvas with `preserveDrawingBuffer` that previously captured transparent pixels behind the avatar now captures the backdrop when `background` is supplied. This is the intended consequence of compositing in-canvas (D-06), but it changes what screenshot endpoints return. Document this for any downstream screenshot-driven features.

### Sampling Bound & Known Limit (Documented, Not a Bug)

**128px readback bound:** A saturated region smaller than ~1% of the frame may be averaged away. This is a bounded-work mitigation (T-16-12), not tunable.

**Evenly-opposed-hues limit:** A background split 50/50 between two opposing saturated hues (e.g. red/cyan checkerboard) has no single correct rim colour. Spike 007 documented this as an accepted limit; tuning for it sacrifices the common case (natural photos with a single dominant light source).

## Threat Flags

None — all threats in the plan's register were mitigated inline:
- **T-16-12 (tainted canvas):** `crossOrigin="anonymous"` set on both loader and sampling Image, `getImageData` wrapped in `try/catch`, failure reported via `onError`.
- **T-16-13 (oversized images):** 50MP ceiling enforced before GPU upload and before sampling, rejection reports via `onError`.
- **T-16-14 (URL scheme tampering):** Allowlist validation before load, `data:` media-type check.
- **T-16-15 (GPU texture leak):** `texture.dispose()` in effect cleanup on URL change and unmount.
- **T-16-16 (silent failures):** All rejection paths report through `onBackgroundError`.

## Commits

| Hash | Message |
|------|---------|
| a2f6567 | feat(16-04): add AvatarBackdrop in-canvas backdrop plane |
| 3b61de8 | feat(16-04): add useBackgroundRimColor and mergeRimColor |
| 2a7b876 | feat(16-04): wire background prop into VRMAvatar and GLBAvatar |

## Files

**Created:**
- `packages/react/src/utils/AvatarBackdrop.tsx` (245 lines)
- `packages/react/src/utils/backgroundRim.ts` (255 lines)

**Modified:**
- `packages/react/src/VRMAvatar.tsx` (+17 lines, imports/props/wiring)
- `packages/react/src/GLBAvatar.tsx` (+17 lines, imports/props/wiring)
- `packages/react/src/index.ts` (+4 lines, barrel exports)

## Next Steps

**Plan 16-05** (if it exists) should handle:
- **Visual verification checkpoint:** Load a real customer background image at multiple aspect ratios (9:16, 16:9, 1:1), confirm cover fit holds across viewport resize, verify derived rim colour reads as belonging to the same scene.
- **khavee-app CORS verification:** Confirm the platform's CDN sends CORS headers for uploaded images; if not, file as a production blocker for background feature launch.

**For plan 16-06 or a future production-readiness checkpoint:**
- Test with a deliberately CORS-blocked image to confirm `onBackgroundError` fires and the scene stays usable (does not throw, does not leave a blank canvas).
- Test with a decode-bomb (small file declaring 50000×50000) to confirm 50MP rejection fires before GPU exhaustion.

## Self-Check: PASSED

✅ **Created files exist:**
```bash
$ ls packages/react/src/utils/AvatarBackdrop.tsx packages/react/src/utils/backgroundRim.ts
packages/react/src/utils/AvatarBackdrop.tsx
packages/react/src/utils/backgroundRim.ts
```

✅ **Commits exist:**
```bash
$ git log --oneline -3
2a7b876 feat(16-04): wire background prop into VRMAvatar and GLBAvatar
3b61de8 feat(16-04): add useBackgroundRimColor and mergeRimColor
a2f6567 feat(16-04): add AvatarBackdrop in-canvas backdrop plane
```

✅ **Build clean:** `pnpm --filter @khaveeai/react build` → exit 0, no errors.

✅ **Tests passing:** 198/198 tests green in `packages/react` test suite.

✅ **Invariants verified:**
- AvatarBackdrop contains all required patterns (meshBasicMaterial, toneMapped={false}, ClampToEdgeWrapping, backdropLayout, dispose(), crossOrigin, size.width/size.height resize dependency).
- backgroundRim contains all required patterns (deriveRimColor, toHex, crossOrigin, getImageData, instanceof Error, 128px bound, try/catch guard).
- Both avatar components wire background prop, call useBackgroundRimColor, pass mergeRimColor(lighting, derivedRim) to AvatarLightRig, render AvatarBackdrop before group.
- index.ts exports AvatarBackdrop, AvatarBackdropProps, AvatarBackground, BackgroundFit.
