---
phase: 16-lighting-shadows-post-processing
plan: 01
subsystem: rendering
tags: [arithmetic, testing, graduation, spike-validation]
dependency_graph:
  requires: [spike-004, spike-007]
  provides: [backdrop-arithmetic, rim-color-derivation]
  affects: []
tech_stack:
  added: []
  patterns: [pure-functions, headless-testing, degenerate-input-guards]
key_files:
  created:
    - packages/react/src/utils/backdropCover.ts
    - packages/react/src/utils/backdropCover.test.ts
    - packages/react/src/utils/deriveRimColor.ts
    - packages/react/src/utils/deriveRimColor.test.ts
  modified: []
decisions:
  - Graduated spike 004's cover/contain arithmetic unchanged - validated findings, not re-derived
  - Only upper-region derivation graduated from spike 007 - mean/dominant/DERIVATIONS removed
  - Return null (not {0,0,0}) when no opaque pixels exist - caller must fall back to static default
  - Iterate top third in place (no Array.prototype.slice.call) - avoids large buffer copy
  - Both modules kept pure (no three/React imports) - enables environment:node testing per vitest.config.ts
metrics:
  duration: 4min
  tasks_completed: 2
  tests_added: 20
  completed_date: 2026-09-14
---

# Phase 16 Plan 01: Graduate Pure Arithmetic Modules - Summary

Graduate spike-validated backdrop-sizing and rim-color-derivation modules into packages/react/src/utils/ with headless vitest coverage.

## What Was Built

Two pure-arithmetic modules moved from throwaway spike pages to production SDK with full test coverage:

**backdropCover.ts** - Backdrop plane sizing and CSS-cover-style texture cropping
- `planeSizeForDistance(fov, aspect, distance)` - frustum-filling plane dimensions  
- `coverTransform(planeAspect, imageAspect)` - center-crop repeat/offset for cover mode
- `visibleFraction(planeAspect, imageAspect)` - diagnostic: what % of image is visible
- `backdropLayout({fov, aspect, distance, imageAspect, fit})` - unified entry point for cover/contain modes
- Degenerate-input guard: non-finite/non-positive values → finite no-crop fallback (not NaN)

**deriveRimColor.ts** - Rim-light color from background images via upper-region saturation-weighted mean
- `deriveRimColor(img)` - analyzes top third only, weights by pixel saturation
- `saturationOf(rgb)` - HSV saturation for comparison/validation
- `toHex(rgb)` - hex string conversion with clamping
- Returns `null` (not black) when no opaque pixels exist
- Achromatic guarantee: grey input stays grey, no hue invented

Both modules follow mtoonRepair.ts conventions: pure functions, full JSDoc, no three/React imports, node-testable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed alpha-skip test logic**
- **Found during:** Task 2 GREEN phase
- **Issue:** Test "excludes low-alpha pixels" expected non-null result when top third (rows 0-42) was entirely transparent. Upper-region derivation correctly returns null when no opaque pixels in sampled region, but test assumed fallback to sampling more of the image.
- **Fix:** Rewrote test fixture so top third contains both transparent pixels (rows 0-19, should be excluded) and opaque pixels (rows 20-42, should be included). Now verifies alpha-skip rule without contradicting null-return-when-empty guarantee.
- **Files modified:** `packages/react/src/utils/deriveRimColor.test.ts`
- **Commit:** 0fb4e29 (GREEN phase commit includes test fix)

## Commits

| Hash    | Type    | Message                                              |
|---------|---------|------------------------------------------------------|
| 9756e17 | test    | add failing test for backdropCover (RED)            |
| 8d38517 | feat    | implement backdropCover (GREEN)                      |
| cf0903b | test    | add failing test for deriveRimColor (RED)           |
| 0fb4e29 | feat    | implement deriveRimColor + fix alpha-skip test (GREEN) |

## Verification Results

### Automated

✓ `pnpm --filter @khaveeai/react test` - 198/198 tests pass (14 test files)
  - backdropCover.test.ts: 10 tests (31.6% visible fraction asserted)
  - deriveRimColor.test.ts: 10 tests (achromatic + beats-mean asserted)
  
✓ `pnpm --filter @khaveeai/react build` - tsc clean, no errors

✓ No lighting-spike imports - `grep -rn "lighting-spike" packages/react/src/` returns nothing

✓ No three/React imports in new modules - both files import only from TypeScript stdlib

✓ Exactly 3 exports from deriveRimColor.ts - no strategy scaffolding (DerivationId/DERIVATIONS/dominantColor removed)

### Manual

None required - pure arithmetic, headlessly tested.

## Requirements Completed

- [x] **BG-01** (arithmetic half): `backdropCover.ts` exists, is node-testable, tests assert 31.6% figure and degenerate-input fallback
- [x] **LIGHT-03** (derivation half): `deriveRimColor.ts` exists with single upper-region derivation, achromatic guarantee under test, adversarial fixture proving it beats plain mean

## Success Criteria Met

- [x] Both modules graduated from spike pages to `packages/react/src/utils/`
- [x] Headless vitest coverage encodes spike findings as executable assertions
- [x] No file under `packages/react/src/` imports from `apps/playground`
- [x] `pnpm --filter @khaveeai/react test` passes (198 tests)
- [x] `pnpm --filter @khaveeai/react build` passes (tsc clean)
- [x] `visibleFraction(16/9, 9/16)` asserted against 0.31640625 (spike 004 headline)
- [x] Achromatic test and "beats plain mean" test both pass (spike 007 guarantees)

## Known Issues / Tech Debt

None. Both modules are production-ready per plan requirements.

## Threat Surface Changes

No new network endpoints, no new dependencies, no new auth surface. Threat register mitigations:

- **T-16-01** (DoS via deriveRimColor pixel loop): O(width × height) with no per-pixel allocation. Spike's Array.prototype.slice.call removed in favor of in-place iteration. Size ceiling enforced by caller (plan 16-04 downsamples to ≤128px).
- **T-16-02** (NaN propagation via backdropLayout): Degenerate-input guard prevents NaN from reaching three.js mesh.scale (asserted by test).
- **T-16-03** (rim color disclosure): Accepted - derived color is customer's own background, rendered back to customer, crosses no trust boundary.
- **T-16-SC** (npm supply chain): Accepted - no new dependencies.

## Self-Check: PASSED

- [x] `packages/react/src/utils/backdropCover.ts` exists
- [x] `packages/react/src/utils/backdropCover.test.ts` exists  
- [x] `packages/react/src/utils/deriveRimColor.ts` exists
- [x] `packages/react/src/utils/deriveRimColor.test.ts` exists
- [x] Commit 9756e17 exists in git log
- [x] Commit 8d38517 exists in git log
- [x] Commit cf0903b exists in git log
- [x] Commit 0fb4e29 exists in git log

## Notes for Next Plans

**For plan 16-03 (plane + lighting rig):**
- Import `backdropLayout` from `./utils/backdropCover` - entry point for both cover/contain
- Pass `fit: "cover"` for standard backdrop, `fit: "contain"` for letterboxed use cases
- Plane dimensions in world units, texture repeat/offset ready for three.js material

**For plan 16-04 (dynamic rim from background):**
- Import `deriveRimColor` from `./utils/deriveRimColor`
- Downsample background texture to ≤128px before canvas readback (bounded-work mitigation)
- Handle null return (no opaque pixels) by falling back to rig's static default rim color
- Use `toHex` for debugging/logging, `saturationOf` for validation assertions
