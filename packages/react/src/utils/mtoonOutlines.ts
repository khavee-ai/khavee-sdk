import * as THREE from "three";
import { MToonMaterial } from "@pixiv/three-vrm";

/**
 * mtoonOutlines - Runtime toggle for MToon outlines already authored by the
 * artist (RESEARCH Pitfall 2, D-10 revised scope).
 *
 * Outlines are generated at glTF-parse time by three-vrm's
 * `_MToonMaterialLoaderPlugin._generateOutline`, gated on the asset's authored
 * `outlineWidthMode` and `outlineWidthFactor`. There is no runtime lever that
 * creates an outline for a mesh that never got the material-array conversion
 * during load. This module therefore hides and restores; it does not generate.
 *
 * Real per-asset reality (measured in spike 001, validated by
 * `mtoonOutlines.assets.test.ts`):
 * - `male.vrm`: 6 of 19 surface materials carry an authored outline
 * - `3636451243928341470.vrm`: 0 of 21 surface materials carry an authored outline
 *
 * On an asset with no authored outlines, `setMToonOutlines(root, false)` is a
 * no-op: it returns 0 and mutates nothing.
 *
 * No `"use client"` directive — this module only imports `three` and
 * `@pixiv/three-vrm`, so it is importable from a headless/Node test (see
 * `mtoonOutlines.assets.test.ts`) without dragging in R3F or JSX, matching the
 * node-testability discipline of `mtoonRepair.ts`.
 */

/** Count of surface MToon materials, plus how many carry an authored outline. */
export interface OutlineCounts {
  /** Surface MToon materials under `root`, excluding three-vrm's generated outline clones. */
  total: number;
  /** Of those, how many carry an authored outline (mode !== "none" and width > 0). */
  outlined: number;
}

/**
 * Module-level snapshot of authored `outlineWidthFactor` values, keyed by
 * material uuid. Used to implement the non-cumulative toggle requirement
 * (`.planning/spikes/CONVENTIONS.md`): restore reads from this snapshot, not
 * from the current (possibly already-suppressed) value. `WeakMap` so disposed
 * models' materials are collectable.
 */
const authoredOutlineWidth = new WeakMap<MToonMaterial, number>();

/**
 * forEachSurfaceMToon - Traverse `root` and yield every surface `MToonMaterial`,
 * skipping three-vrm's generated outline clones (`isOutline === true`). The
 * outline clone is a second material object for the same surface mesh and must
 * not be counted or mutated here — the surface material's `outlineWidthFactor`
 * already controls whether the outline renders.
 */
function forEachSurfaceMToon(
  root: THREE.Object3D,
  fn: (m: MToonMaterial) => void,
): void {
  const seen = new Set<string>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!(mat instanceof MToonMaterial)) continue;
      if (mat.isOutline) continue; // skip the outline clone
      if (seen.has(mat.uuid)) continue;
      seen.add(mat.uuid);
      fn(mat);
    }
  });
}

/**
 * countOutlinedMaterials - Count surface MToon materials under `root` and how
 * many carry an authored outline.
 *
 * `outlined` counts materials where `outlineWidthMode !== "none"` AND the
 * AUTHORED width is greater than 0 — read from the snapshot when one exists,
 * so the count does not change depending on whether outlines are currently
 * suppressed. This property makes the count usable as a stable diagnostic in
 * plan 16-06's frame-cost harness.
 *
 * @param root - Root object to traverse (e.g. a loaded VRM scene).
 * @returns `{ total, outlined }` — counts of surface materials and how many
 *   carry an authored outline.
 */
export function countOutlinedMaterials(root: THREE.Object3D): OutlineCounts {
  let total = 0;
  let outlined = 0;
  forEachSurfaceMToon(root, (m) => {
    total++;
    if (m.outlineWidthMode === "none") return;
    // Read the authored width: prefer the snapshot value if one exists
    // (material was suppressed at least once), otherwise read the current
    // value (material never touched yet, so current === authored).
    const width = authoredOutlineWidth.has(m)
      ? authoredOutlineWidth.get(m)!
      : m.outlineWidthFactor;
    if (width > 0) outlined++;
  });
  return { total, outlined };
}

/**
 * setMToonOutlines - Hide or restore authored outlines at runtime.
 *
 * - `enabled === false`: for each surface material whose `outlineWidthMode !==
 *   "none"` and whose current `outlineWidthFactor` is greater than 0, record
 *   the current value in the module-level `WeakMap` if not already recorded,
 *   then assign `outlineWidthFactor = 0`.
 * - `enabled === true`: for each surface material present in the `WeakMap`,
 *   restore the recorded value and leave the map entry in place so repeated
 *   toggling stays non-cumulative.
 *
 * Materials with `outlineWidthMode === "none"` are never written to, in either
 * direction — they declared no outline at parse time, so there is nothing to
 * suppress or restore.
 *
 * @param root - Root object to traverse (e.g. a loaded VRM scene).
 * @param enabled - `false` to suppress outlines, `true` to restore them.
 * @returns The number of materials touched in either direction.
 */
export function setMToonOutlines(root: THREE.Object3D, enabled: boolean): number {
  let count = 0;
  forEachSurfaceMToon(root, (m) => {
    if (m.outlineWidthMode === "none") return;

    if (!enabled) {
      // Suppress: record the current value before zeroing, so restore can
      // put it back exactly.
      if (m.outlineWidthFactor > 0) {
        if (!authoredOutlineWidth.has(m)) {
          authoredOutlineWidth.set(m, m.outlineWidthFactor);
        }
        m.outlineWidthFactor = 0;
        count++;
      }
    } else {
      // Restore: read the snapshot value if one exists. If the material was
      // never suppressed (no snapshot entry), it is already at its authored
      // width — do nothing.
      if (authoredOutlineWidth.has(m)) {
        m.outlineWidthFactor = authoredOutlineWidth.get(m)!;
        count++;
      }
    }
  });
  return count;
}
