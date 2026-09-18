# Phase 17: Camera Direction & Scene Composition - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-18
**Phase:** 17-camera-direction-scene-composition
**Areas discussed:** Camera ownership, Orbit vs. locked, Handheld drift, State reframing

---

## Camera Ownership

### Q1: SDK camera component shape

| Option | Description | Selected |
|--------|-------------|----------|
| Ship a component | SDK ships `<AvatarCamera>` inside Canvas like `<AvatarLightRig>` | |
| Bake into avatar | Add `autoCamera` prop to VRMAvatar/GLBAvatar | |
| Separate component | Ship `<AvatarCamera>` per-Canvas, same pattern as `AvatarPostFX` | ✓ |

**User's choice:** Separate component (per-Canvas, not per-avatar)

### Q2: Default-on or opt-in

| Option | Description | Selected |
|--------|-------------|----------|
| Opt-in | Consumer must mount `<AvatarCamera>` explicitly | ✓ |
| Default-on | Auto-mount like `AvatarLightRig` | |

**User's choice:** Opt-in

### Q3: Preset count

| Option | Description | Selected |
|--------|-------------|----------|
| 2 presets | bust-shot + medium-close-up | |
| 3 presets | bust-shot, medium-close-up, full-body | ✓ |
| 4+ presets | Multiple angles and distances | |

**User's choice:** 3 presets

### Q4: Custom position API

| Option | Description | Selected |
|--------|-------------|----------|
| preset + position/target override | `preset="bust-shot" position={[0,1.5,2.5]}` | ✓ |
| You decide | Let Claude determine API shape | |

**User's choice:** Preset string + explicit position/target/fov override props

---

## Orbit vs. Locked

### Q1: Orbit freedom

| Option | Description | Selected |
|--------|-------------|----------|
| Locked (no orbit) | Camera fixed to preset, no user interaction | |
| Constrained orbit | User can orbit within clamped ranges | |
| Mode toggle | `orbit="locked" \| "constrained" \| "free"` prop | ✓ |

**User's choice:** Mode toggle

### Q2: Default orbit mode

| Option | Description | Selected |
|--------|-------------|----------|
| locked | Default locked, dev switches to free for debug | ✓ |
| constrained | Default constrained, user can orbit within limits | |

**User's choice:** locked

### Q3: Runtime preset swap

| Option | Description | Selected |
|--------|-------------|----------|
| No (developer-chosen only) | Preset fixed, consumer builds own swap UI if needed | |
| Yes (runtime swap) | Changing preset prop triggers smooth transition | ✓ |

**User's choice:** Runtime swap with smooth eased transitions

### Q4: Transition style

| Option | Description | Selected |
|--------|-------------|----------|
| Smooth ease | easeInOutCubic, ~0.8–1.5s | ✓ |
| Instant snap | No animation | |
| You decide | Claude decides timing/easing | |

**User's choice:** Smooth ease

---

## Handheld Drift

### Q1: Drift implementation

| Option | Description | Selected |
|--------|-------------|----------|
| Procedural noise | Perlin/simplex on camera position+target | ✓ |
| Sine-based sway | Layered sine waves like breathing.ts | |
| You decide | Claude picks implementation | |

**User's choice:** Procedural noise

### Q2: Drift pause behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Always on | Runs across all chatStatus, pauses only during user orbit | ✓ |
| Pause during user input | Pauses during orbit, fades back | |
| You decide | Claude decides pause behavior | |

**User's choice:** Always on

---

## State Reframing

### Q1: Reframing scope

| Option | Description | Selected |
|--------|-------------|----------|
| Dolly only | Subtle ~5-10% push-in on speaking, ease back on listening/ready | ✓ |
| Dolly + slight tilt | Push-in + target shifts up toward face | |
| Full reframe per state | Each chatStatus has its own sub-preset | |

**User's choice:** Dolly only

### Q2: Default behavior

| Option | Description | Selected |
|--------|-------------|----------|
| On by default | drift={true} reframe={true} when AvatarCamera is mounted | ✓ |
| Off by default | Consumer must opt-in to drift and reframe | |

**User's choice:** On by default

---

## Claude's Discretion

- Exact camera positions, targets, and fov values for the 3 presets
- Noise parameters for handheld drift (frequency, octaves, amplitude)
- Easing curve/duration specifics for preset transitions and state reframing
- Constrained-mode clamp ranges per preset
- Whether to use drei's CameraControls internally or manage camera via useFrame

## Deferred Ideas

- LLM-triggered camera changes (belongs in Phase 18 or future cinematographic direction phase)
- Camera drift as a Phase 13 performance tier target
- Camera shake on specific events (future polish pass)
