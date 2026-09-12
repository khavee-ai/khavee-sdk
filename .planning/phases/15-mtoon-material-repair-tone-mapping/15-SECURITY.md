---
phase: 15
slug: mtoon-material-repair-tone-mapping
status: verified
threats_open: 0
asvs_level: 1
created: 2026-09-13
---

# Phase 15 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|----------------|
| remote `.vrm`/texture asset → renderer | A `VRMAvatar` `src` may be a third-party URL; its textures become `THREE.Texture` objects the repair pass samples | Decoded texel/pixel data |
| `averageTextureColor` → 2D canvas readback | Cross-origin texture data crossing into `getImageData` | Pixel RGBA bytes |
| repo `.vrm` asset → test process | Test-time parsing of large binary GLB files from the repo working tree | Binary GLB bytes |
| consuming app `<Canvas>` renderer → SDK | `applyRendererDefaults` mutates a renderer the SDK does not own | Renderer global state (toneMapping, colorSpace) |
| consuming app props → material mutation | `materialPreset`/`debugShading` drive writes to loaded material state | Material factor/shader state |
| playground page → SDK public API | Dev-only pages consuming the newly exported repair functions | In-memory `THREE.Object3D` graphs |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-15-01 | Information Disclosure | `averageTextureColor` Path B (canvas readback) | mitigate | try/catch around `getImageData`, returns `null` on `SecurityError`; only an averaged colour is ever surfaced | closed |
| T-15-02 | Denial of Service | `averageTextureColor` Path A (typed-array) | mitigate | Path A bounded by asset already decoded in memory; Path B readback canvas fixed at 16×16 regardless of source size | closed |
| T-15-03 | Tampering | `repairMToonMaterials` mutating shared materials | accept | Reversible via `snapshotMToon`/`restoreMToon`; `VRMAvatar` parses an independent scene per component instance (no `useLoader` cache) so no cross-instance material sharing | closed |
| T-15-04 | Denial of Service | `loadVrmScene` in CI | mitigate | Explicit `120_000`ms timeout on every `it()`; each of the three models loaded at most once per `it` block; texture decode stubbed via a registered GLTFLoader plugin | closed |
| T-15-05 | Tampering | test asset path traversal | accept | `MODELS_DIR` resolved from `import.meta.url`; filenames are hardcoded string literals in `it()` arrays, never derived from input | closed |
| T-15-06 | Tampering | `applyRendererDefaults` Canvas-global write | accept | Pre-existing documented side effect (value changed, not scope); escape hatch is the `toneMapping` prop (`VRMAvatar.tsx:428`, `toneMapping ?? THREE.CineonToneMapping`) | closed |
| T-15-07 | Tampering | `materialPreset` apply effect | mitigate | Apply effect always calls `restoreMToon` from the per-`scene` snapshot before any repair, making the write non-cumulative; snapshot effect declared before apply effect and cleared to `null` in its cleanup on unmount/`scene` change | closed |
| T-15-08 | Denial of Service | `debugShading` toggle | accept | Bounded by material count (max 21); prop defaults to `false` (`VRMAvatar.tsx:376`) | closed |
| T-15-09 | Information Disclosure | `measureCanvas` readback on `/mtoon-spike` | accept | Reads back only the page's own locally-rendered `<canvas>`; `apps/playground/package.json` declares `"private": true` | closed |
| T-15-10 | Elevation of Privilege | newly public repair exports | accept | `repairMToonMaterials`/`snapshotMToon`/`restoreMToon`/`setMToonDebugMode` (and `DEFAULT_REPAIR`/`FACE_DETAIL_MATERIAL_RE`) mutate only the caller-supplied `THREE.Object3D` graph; no I/O, eval, or network call anywhere in `mtoonRepair.ts` | closed |
| T-15-SC | Tampering | npm installs | accept | `git diff` of committed `package.json` changes between phase start (`aadb9b1`) and HEAD (`a348ace`) is empty — no dependency added by this phase | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|--------------|------|
| AR-15-01 | T-15-03 | Material mutation is reversible (`snapshotMToon`/`restoreMToon`) and each `VRMAvatar` instance parses its own independent scene graph via `GLTFLoader.parseAsync` — no shared/cached material instances across avatars | Phase 15 plan 01 | 2026-09-13 |
| AR-15-02 | T-15-05 | Test asset path is a constant derived from `import.meta.url`; filenames are hardcoded literals, never interpolated from external input | Phase 15 plan 02 | 2026-09-13 |
| AR-15-03 | T-15-06 | Pre-existing documented Canvas-global side effect; this phase only changed the tone-mapping VALUE (ACESFilmic → Cineon), not the scope of the write; `toneMapping` prop remains the escape hatch | Phase 15 plan 03 | 2026-09-13 |
| AR-15-04 | T-15-08 | Shader recompile cost bounded by material count (≤21 across shipped assets) and gated behind a dev-facing prop defaulting to `false` | Phase 15 plan 03 | 2026-09-13 |
| AR-15-05 | T-15-09 | `/mtoon-spike` only reads back its own locally-rendered canvas; `apps/playground` is a non-published app (`"private": true`) | Phase 15 plan 04 | 2026-09-13 |
| AR-15-06 | T-15-10 | Newly exported repair functions perform pure in-memory `THREE.Object3D`/`MToonMaterial` mutation only — no I/O, eval, or network surface | Phase 15 plan 04 | 2026-09-13 |
| AR-15-07 | T-15-SC | No new dependency was added by any of the four phase plans (verified via `git diff` of committed `package.json` changes) | Phase 15 plans 01-04 | 2026-09-13 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-13 | 11 | 11 | 0 | gsd-security-auditor |

Note: the register lists 13 rows across four plans, but `T-15-SC` is a single logical threat repeated verbatim in every plan (no new dependencies added by any plan) — it is audited and counted once above, yielding 11 distinct threats.

### Verification notes

- **T-15-01 / T-15-02** — `packages/react/src/utils/mtoonRepair.ts:207-241`: Path B's entire `getImageData` call and its surrounding pixel-averaging loop are wrapped in `try { ... } catch { return null; }`; canvas `width`/`height` are hardcoded to `16` (`const size = 16;`, line 208) independent of the source texture's dimensions.
- **T-15-04** — `packages/react/src/utils/mtoonRepair.assets.test.ts`: every one of the five `it()` blocks passes `ASSET_TIMEOUT` (`120_000`) as its third argument; each model filename appears in exactly one loop/scope per `it()` (loaded once); `loader.register` stubs `loadTexture`/`loadTextureImage`/`assignTexture` to return image-less `THREE.Texture()` instances before `VRMLoaderPlugin` runs, so no image decode occurs.
- **T-15-07** — `packages/react/src/VRMAvatar.tsx:574-599`: the snapshot effect (keyed on `[scene]`, clears `mtoonSnapshotRef.current` to `null` in its cleanup) is declared immediately before the apply-preset effect (keyed on `[scene, materialPreset]`), which unconditionally calls `restoreMToon(scene, mtoonSnapshotRef.current)` before ever calling `repairMToonMaterials`. Independently corroborated by `15-REVIEW.md`'s adversarial trace of React StrictMode double-invocation, which found no sequence that snapshots post-repair values.
- **Spot-checks** — `apps/playground/package.json:4` declares `"private": true` (T-15-09 premise). `mtoonRepair.assets.test.ts:54-56,102-136` shows `MODELS_DIR` built from `import.meta.url` and filenames as literal strings in array/object literals, never interpolated from a variable (T-15-05 premise). `git diff aadb9b1..HEAD -- '**/package.json'` returns empty for committed changes — the two currently-modified `package.json` files (`packages/core`, `packages/providers/openai-realtime`) are uncommitted and unrelated to this phase per the task's explicit instruction to judge committed changes only (T-15-SC premise).
- **SUMMARY.md Threat Flags** — none of `15-01-SUMMARY.md` through `15-04-SUMMARY.md` contain a `## Threat Flags` section; no unregistered attack surface to reconcile.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-13
