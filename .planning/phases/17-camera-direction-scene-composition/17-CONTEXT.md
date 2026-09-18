# Phase 17: Camera Direction & Scene Composition - Context

**Gathered:** 2026-09-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the unconstrained free-orbit camera that lets a viewer land on any
(often unflattering) angle with a curated, SDK-owned camera system. Delivers:
framing presets, subtle handheld-drift camera life, and chatStatus-driven
reframing — so the avatar is always framed deliberately and the scene never
reads as a static render.

Phase 16 delivered `SubjectFocusTracker` (DOF), `AvatarBackdrop`, and a
three-point light rig that assume a camera position. This phase owns the camera
that completes the composition those systems were designed for.

</domain>

<decisions>
## Implementation Decisions

### Camera component shape and API

- **D-01:** Ship a new **`<AvatarCamera>`** component, separate from
  `VRMAvatar`/`GLBAvatar`. Rationale: a camera is per-Canvas, not per-avatar
  (same constraint as `AvatarPostFX`), and keeping it separate avoids expanding
  the already-large avatar components. Follows the established pattern:
  `AvatarLightRig` (per-avatar group), `AvatarPostFX` (per-Canvas), and now
  `AvatarCamera` (per-Canvas).
- **D-02:** `AvatarCamera` is **opt-in** — consumers must mount it explicitly.
  No `autoCamera` prop on the avatar components. Rationale: every existing
  consumer already has its own camera controls (`OrbitControls`, `CameraControls`,
  etc.); injecting an SDK camera by default would create a conflict with no
  escape hatch that doesn't also break existing setups. This is the same
  reasoning that makes `AvatarPostFX` opt-in (takes over the entire Canvas
  render pipeline).
- **D-03:** Three built-in **framing presets**: `"bust-shot"` (default),
  `"medium-close-up"`, and `"full-body"`. Covers the three main use cases: chat
  widget (bust/MCU), presentation/showcase (full-body).
- **D-04:** Consumer can override any preset's framing via explicit **`position`,
  `target`, and `fov` props**. An explicit prop overrides the preset's default
  for that axis only: `<AvatarCamera preset="bust-shot" position={[0, 1.5, 2.5]} />`
  uses the bust-shot target and fov but a custom position.

### Orbit mode and user interaction

- **D-05:** `AvatarCamera` exposes an **`orbit` mode prop**: `"locked"` |
  `"constrained"` | `"free"`. Default is `"locked"`.
  - `"locked"` — camera is fixed to the preset position. No user interaction
    (drag/scroll) moves the camera. This is the production-widget default: the
    developer chooses the framing, the viewer sees only that framing.
  - `"constrained"` — user can orbit within clamped polar, azimuth, and
    distance ranges that keep the avatar framed from flattering angles only.
  - `"free"` — unconstrained orbit, equivalent to today's `OrbitControls`
    behaviour. For dev/debug only.
- **D-06:** Presets are **runtime-swappable**. Changing the `preset` prop
  triggers a **smooth eased transition** (easeInOutCubic, ~0.8–1.5s) from the
  current camera position to the new preset's position — the same
  cinematographic quality the animation system uses for crossfades.

### Handheld drift (camera life)

- **D-07:** Handheld drift uses **procedural noise** (Perlin/simplex) on the
  camera's position and target each frame, with very low amplitude (~0.5–2 cm
  world-space). The effect is that the shot never looks perfectly static, reads
  as a real camera rather than a CG render.
- **D-08:** Drift is **always on** (across all `chatStatus` values). It pauses
  only when the user is actively orbiting in `"constrained"` or `"free"` mode
  (to avoid fighting user input). Drift resumes after user interaction ends.
- **D-09:** `drift` prop defaults to `true`. Consumer can disable it:
  `drift={false}`.

### State-driven reframing

- **D-10:** State reframing is a **dolly only** — a subtle ~5–10% push-in
  toward the avatar when `chatStatus` transitions to `"speaking"`, and an ease
  back to the base preset distance when it returns to `"listening"` or
  `"ready"`. No angle, target, or framing change — just distance. This
  mirrors real cinematographic language (a slow push-in signals focus/attention)
  and is subtle enough to feel natural without being distracting.
- **D-11:** `reframe` prop defaults to `true`. Consumer can disable it:
  `reframe={false}`.
- **D-12:** Both drift and reframe are **on by default** when `AvatarCamera`
  is mounted: `<AvatarCamera />` gives a developer the full experience with
  zero additional configuration.

### Claude's Discretion

- Exact preset camera positions, targets, and fov values for the 3 presets —
  to be determined empirically during planning/execution against real avatars.
- Exact noise parameters for handheld drift (frequency, octaves, amplitude
  per axis) — tune for "subtle enough to not notice consciously, obvious enough
  that removing it makes the scene feel dead."
- Easing curve and duration specifics for preset transitions and state reframing.
- How `orbit="constrained"` clamps are defined (exact polar/azimuth/distance
  ranges) — these need to work across all 3 presets and likely vary per preset.
- Whether to use drei's existing `CameraControls` internally or manage the
  camera directly via `useFrame` — an implementation decision the researcher
  should evaluate.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 16 foundations this phase builds on
- `.planning/phases/16-lighting-shadows-post-processing/16-CONTEXT.md` — locked
  lighting/shadow/post decisions. D-06 (backdrop plane), D-13 (tone mapping
  fix), and D-05 (rim from background) all assume a camera at a particular
  distance; framing presets must be tuned against the lighting they produce.
- `packages/react/src/utils/AvatarBackdrop.tsx` — backdrop plane follows the
  camera's world position and direction per-frame via `useFrame`. Camera moves
  from `AvatarCamera` must cooperate — the backdrop must stay behind the
  subject, not lag or jitter.
- `packages/react/src/utils/renderQuality.tsx` — `AvatarLightRig`,
  `AvatarPostFX`, `ShadowFloor`, `SubjectFocusTracker`. The `SubjectFocusTracker`
  computes DOF focus distance from camera-to-subject each frame; any camera
  dolly from state reframing will cause it to re-track automatically (by design,
  per spike 004). Verify this interaction works smoothly.

### Phase 12 gaze interaction
- `packages/react/src/animation/gaze.ts` — camera-relative gaze reads
  `useThree().camera` (D-04 from Phase 12). When `AvatarCamera` moves the
  camera, gaze direction changes dynamically. This is correct behaviour but
  worth verifying that drift amplitude doesn't cause visible gaze jitter.

### Spike findings
- `.planning/spikes/MANIFEST.md` — spike 004 (backdrop-plane-dof) established
  that DOF focus must derive from live camera distance, never a constant.
  Phase 17 adds camera moves that validate this design.

### Code the phase modifies or must not break
- `packages/react/src/VRMAvatar.tsx` — does NOT change (camera is a separate
  component, not baked into the avatar).
- `packages/react/src/GLBAvatar.tsx` — does NOT change.
- `packages/react/src/index.ts` — add `AvatarCamera` and its types to the
  barrel export.
- `apps/playground/` — existing demo pages use `OrbitControls`; they are NOT
  affected by `AvatarCamera` (opt-in). A new demo page or harness should wire
  `AvatarCamera` for verification.

### Project-level constraints
- `CLAUDE.md` — repo-wide compatibility constraint: existing consumers must
  keep working unchanged. `AvatarCamera` being opt-in satisfies this.
- `.planning/ROADMAP.md` §Phase 17 — the three scope items (framing presets,
  subtle camera life, state-driven reframing).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AvatarBackdrop` / `SubjectFocusTracker` (Phase 16) — already track camera
  per-frame. No new integration needed; they cooperate with any camera position
  by design.
- `breathing.ts` / `sway.ts` (Phase 11) — procedural noise pattern. The
  handheld drift is the same idea applied to the camera instead of bones.
  The sine-based approach and `step()` function pattern are directly reusable
  as a structural reference, though camera drift should use noise rather than
  sine for a more organic feel.
- `AvatarPostFX` and `AvatarLightRig` — the component-shape precedent for how
  `AvatarCamera` should be designed (exported function component, props
  interface, mounted as a sibling inside Canvas).
- drei's `CameraControls` — already a dependency used in
  `apps/playground/src/app/components/Experience.tsx`. Wraps
  `camera-controls-dev` which supports smooth transitions, angle clamping,
  distance limits, and programmatic dolly/rotate. Could serve as the internal
  implementation for `AvatarCamera`'s orbit modes.

### Established Patterns
- **Opt-in per-Canvas components** — `AvatarPostFX` is the precedent: a
  component that takes over a Canvas-wide concern, mounted exactly once, with
  sensible defaults and granular opt-out props.
- **Props follow "partial override" convention** — Phase 16's `lighting` prop
  shows the pattern: omit and get defaults, pass a partial object to override
  specific axes. `AvatarCamera`'s `position`/`target`/`fov` follow the same
  "explicit prop overrides preset's default for that axis" convention.
- **useFrame for per-frame state** — all procedural animation (breathing, sway,
  gaze, expression drift) runs in `useFrame`. Camera drift and state reframing
  will use the same mechanism.

### Integration Points
- **`useThree().camera`** — `AvatarCamera` must set R3F's active camera or
  manipulate the default camera. `gaze.ts`, `SubjectFocusTracker`, and
  `AvatarBackdrop` all read from `useThree().camera`, so `AvatarCamera` must
  work through this standard channel.
- **`useKhavee().chatStatus`** — state reframing needs `chatStatus` from
  context. Already available via the `useKhavee()` hook.

</code_context>

<specifics>
## Specific Ideas

- The user chose **locked** as the default orbit mode, which matches competitor
  products like Animates where the viewer never controls the camera.
- Runtime preset swap was requested with smooth eased transitions — the user
  expects this to feel cinematic, not mechanical.
- Dolly-only state reframing was chosen over full reframe per state — keep it
  subtle, like real cinematography.

</specifics>

<deferred>
## Deferred Ideas

- **LLM-triggered camera changes** — the LLM could call a tool to switch
  presets or trigger a dramatic camera move. Belongs in Phase 18 (emotion
  channel) or a future "cinematographic direction" phase rather than here.
- **Phase 13 performance tiers** — still not started. Camera drift adds a
  per-frame cost (noise evaluation + position update). When Phase 13 lands,
  drift should be tier-gated so weak devices can disable it automatically.
- **Camera shake on events** — a brief shake or pulse on specific events
  (e.g., tool call result). Too specific for this phase; belongs in a future
  polish pass.

</deferred>

---

*Phase: 17-camera-direction-scene-composition*
*Context gathered: 2026-09-18*
