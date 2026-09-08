# Phase 15 Context — MToon Material Repair & Tone Mapping

**Origin:** not from `/gsd:discuss-phase`. Scope was settled empirically by spikes 001-003, so
the decisions below are recorded as already-locked rather than gathered by questioning.

## Locked decisions

| Decision | Value | Basis |
|---|---|---|
| Pass semantics | **repair, not override** — only rewrite values proven broken | 002: a well-authored model the pass modifies (7/21 materials) was human-judged unchanged |
| `materialPreset` default | `"repair"` (on by default) | 002 non-regression result |
| Threshold basis | **runtime** MToon values, never raw `.vrm` file values | 001: v0compat rewrites them; 2 file-derived rules were dead/dangerous |
| Face-detail materials | never touched, exclusion runs before any rule | 001: 7/7 "flat" materials on `male.vrm` are eyes/lashes/brows |
| Rim injection | must also raise fresnel power when < 2 | 002: colour alone produces a full-body wash |
| Rim tint source | base **texture** average, not `litFactor` | 003: `litFactor` is white on VRoid models -> grey rim, measurably desaturating |
| Tone mapping default | `THREE.CineonToneMapping` | 003: +35% sat vs ACES, ~no contrast loss; human pick |
| `NoToneMapping` | **not offered** as a flat-look option | 003: measured second-lowest saturation of six curves |
| Multiply-texture slots | skip a rule when its MToon multiply texture is present | 001 caveat: factor-only inspection cannot see texture-driven values |

## Constraints

- `openai-stt-tts` and every existing `VRMAvatar`/`GLBAvatar` consumer must keep working
  (repo-wide constraint in `CLAUDE.md`).
- The existing `toneMapping` prop must continue to override the new default.
- `applyRendererDefaults` mutates the Canvas-shared `WebGLRenderer` — a documented, accepted
  global side effect (`renderQuality.tsx`). Changing the default curve inherits that
  side effect; it is not a new one, but it is renderer-wide.
- `happy.glb` is plain glTF PBR, not MToon — a different shading path, out of scope here.

## Explicitly out of scope this phase

Deferred to the next render-quality round, so this phase's effect stays attributable:
3-point light rig / rim-and-fill lighting, post-processing (DOF, vignette, colour grading),
MToon outlines (extra draw pass per material — belongs with performance tiers), camera framing
and direction.
