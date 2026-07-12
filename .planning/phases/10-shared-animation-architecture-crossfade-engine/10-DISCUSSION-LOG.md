# Phase 10: Shared Animation Architecture & Crossfade Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-12
**Phase:** 10-shared-animation-architecture-crossfade-engine
**Areas discussed:** Procedural layer scope now, Reuse the crossfade prototype, Test assets for this phase

---

## Procedural layer scope now

| Option | Description | Selected |
|--------|-------------|----------|
| Migrate blink now | Move the existing working blink code into the shared module's procedural delta layer during Phase 10. Proves the layer with one real, already-correct behavior instead of shipping an empty stub; GLB also gets blink for free (it has none today). | ✓ |
| Scaffold only, leave blink in place | Phase 10 just builds the extensible per-frame delta-layer hook/mechanism (empty). Blink migration and all other procedural behaviors wait until Phase 11. | |

**User's choice:** Migrate blink now (Recommended)
**Notes:** Rationale: blink is the exact "already-proven pattern" wayfinder ticket #2 pointed to for the procedural delta layer to extend.

---

## Reuse the crossfade prototype

| Option | Description | Selected |
|--------|-------------|----------|
| Port the prototype code | Cherry-pick/reference the actual `setEffectiveWeight` blending logic from commit 6d0b9d7 as the starting implementation, adapted into the new shared module. | ✓ |
| Reference notes only, reimplement fresh | Treat the prototype purely as validated design notes. Write new code directly against the shared module's real interfaces without touching the old branch. | |

**User's choice:** Port the prototype code (Recommended)
**Notes:** Prototype branch `wayfinder/5-crossfade-prototype` (commit 6d0b9d7) confirmed to still exist locally; validated the formula against `happy.glb`'s real clips on a since-reverted copy of `src/app/glb/page.tsx`.

---

## Test assets for this phase

| Option | Description | Selected |
|--------|-------------|----------|
| Use existing bundled clips | Test the shared module + crossfade against `public/models/animations/*.fbx` and `happy.glb`'s embedded clips as-is. License-flagged (issue #11) but that's a separately tracked compliance issue. | ✓ |
| Build a minimal synthetic clip harness | Create small throwaway test-only AnimationClips so pose-gap/crossfade math can be verified with exact, predictable numbers. | |

**User's choice:** Use existing bundled clips (Recommended)
**Notes:** Confirmed bundled clips exist: `public/models/animations/{Idle,talking,talking1}.fbx`, plus `happy.glb`'s embedded `Idle`/`Taking`/`listening` clips (same fixtures the prototype used). Final CC0 clips (issue #17) not sourced yet — out of reach this phase regardless.

---

## Claude's Discretion

- Exact file/module location and naming for the new shared internal module within `packages/react/src` (wayfinder ticket #8 left this unspecified — only requirement is that it stays internal, not exported from public `index.ts`).
- Whether the format-adapter interface is declared as a TypeScript `interface` or an object literal shape.
- How existing public props (`enableBlinking`, `enableTalkingAnimations`, `autoPlayAnimation`) map onto or coexist with the new internal module during this phase, given Phase 13 owns the actual new public API surface.

## Deferred Ideas

- Sourcing final CC0 clips for `stopped`/`listening`/`thinking`/2nd `speaking` variant — issue #17, out of reach this phase.
- Fixing the bundled Mixamo files' redistribution-license risk — issue #11, unrelated compliance work.
- All idle/talking/gaze/gesture procedural behaviors — Phase 11/12 scope.
- New public API surface (`enableNaturalMotion`, reserved `animations` keys, zero-config defaults) — Phase 13 scope.
