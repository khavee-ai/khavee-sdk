# Phase 11: Bone-Masked Upper-Body Animation Layering - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-01
**Phase:** 11-bone-masked-upper-body-animation-layering
**Areas discussed:** Bone split, Head bone treatment, Custom animation scope, Idle-upper fallback, Crossfade timing

---

## Bone Split

| Option | Description | Selected |
|--------|-------------|----------|
| Chest+neck in upper body | Base = hips, spine, legs/feet only. Upper = chest, upperChest, neck, head, shoulders, arms, hands. | ✓ |
| Chest+neck in base body | Base = hips, spine, chest, upperChest, neck. Upper = head, shoulders, arms, hands only. | |
| Split neck/chest by bone | Chest/upperChest in base, neck moves with upper as a unit with head. | |

**User's choice:** Chest+neck in upper body (recommended option).
**Notes:** Gives gesture clips coherent torso-lean + arm motion together, matching how most gesture FBX clips are authored.

---

## Head Bone Treatment

| Option | Description | Selected |
|--------|-------------|----------|
| Head stays in upper-body gesture mask | Gesture FBX clips still animate head; Phase 10 procedural head deltas continue applying additively on top, unchanged. | ✓ |
| Head excluded from gesture clips entirely | Gesture clips drive only shoulders/arms/hands; head is 100% procedural (Phase 10 layer only). | |

**User's choice:** Head stays in upper-body gesture mask.
**Notes:** This phase fixes the whole-body snap, not the head/procedural interaction itself — that's intentionally left as-is.

---

## Custom Animation Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Only status-mapped anims are masked | Bone masking applies only to idle/listening/thinking/speaking auto-mapping. Explicit `animate('dance')` calls keep the old whole-body crossfade. | ✓ |
| All animations are bone-masked | Every `animate()` call, including custom developer-triggered ones, plays as an upper-body-only layer. | |

**User's choice:** Only status-mapped anims are masked (recommended option).
**Notes:** Smaller, well-scoped change matching the roadmap's literal wording; developers keep full-body control for custom animations.

---

## Idle Upper Fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Idle's own upper-body tracks | Idle stays a full-skeleton clip; its upper-body tracks are also sliced out and played as the default upper-body layer at rest, crossfading to/from gesture clips. | ✓ |
| Freeze at bind/last pose when idle | No upper-body clip plays during 'ready'; arms/chest/head hold last pose, relying on Phase 10 procedural layer. | |

**User's choice:** Idle's own upper-body tracks (recommended option).
**Notes:** Keeps arm-swing/torso motion continuous at rest instead of freezing on bind pose.

---

## Crossfade Timing

| Option | Description | Selected |
|--------|-------------|----------|
| Keep 0.3s | Same crossfade duration as today's whole-body swap — no new tunable. | ✓ |
| Slower, ~0.5s | Slightly longer blend for a softer upper-body transition. | |

**User's choice:** Keep 0.3s (recommended option).
**Notes:** Consistent feel with existing behavior; no new tunable prop introduced this phase.

---

## Claude's Discretion

- Exact mechanism for filtering `THREE.AnimationClip` tracks into base/upper sub-clips (utility function shape, memoization strategy).
- Single mixer hosting both base and upper actions simultaneously vs. two separate `THREE.AnimationMixer` instances.
- Fallback behavior for non-Mixamo GLB clips with arbitrary bone names used as a status key (edge case, not raised by user).

## Deferred Ideas

- Excluding head entirely from gesture-clip control (full procedural head ownership) — considered, explicitly rejected this phase; could resurface as its own phase if the head-bone collision remains a distinct problem.
- Bone masking for developer-triggered custom animations — deferred as a separate, larger API change.
- Tunable crossfade duration prop — deferred; hardcoded at 0.3s this phase.
- Bone masking for non-Mixamo GLB clips — not raised; revisit if it becomes a real use case.
