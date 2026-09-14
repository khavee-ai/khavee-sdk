import * as THREE from "three";
import { MToonMaterial } from "@pixiv/three-vrm";

/**
 * mtoonOutlines - Runtime control of MToon outlines (OUTLINE-01).
 *
 * three-vrm generates an outline at glTF-parse time only when the asset
 * authored `outlineWidthMode !== "none"` AND `outlineWidthFactor > 0`
 * (`_MToonMaterialLoaderPlugin._shouldGenerateOutline`). The outline is a
 * separate cloned material (`isOutline: true`, `BackSide`) drawn through a
 * second geometry group, with its own copy of every uniform — so writing the
 * surface material's width does nothing to a drawn outline.
 *
 * Measured per-asset reality (spike 001 audit, `mtoonOutlines.assets.test.ts`):
 * - `male.vrm`: 6 materials set an outline mode but author width 0, so
 *   three-vrm generated no outline at all
 * - `3636451243928341470.vrm`: no outline mode set
 * - `262410318834873893.vrm`: 10 of 18 materials carry a generated outline,
 *   authored at 0.0005 world units (nearly invisible at typical framing)
 *
 * Because authored outlines are rare or too thin to see, `setMToonOutlines`
 * accepts a width override that builds the outline itself for surfaces that
 * have none, mirroring three-vrm's load-time generation (user decision
 * 2026-09-14, superseding D-10's respect-existing-only scope).
 *
 * No `"use client"` directive — imports only `three` and `@pixiv/three-vrm`, so
 * it stays loadable from the node-environment asset test.
 */

/** Outline presence under a root, counted per unique surface material. */
export interface OutlineCounts {
  /** Surface MToon materials under `root`, excluding outline clones. */
  total: number;
  /** Surfaces carrying an outline three-vrm generated from the asset's own values. */
  outlined: number;
  /** Surfaces carrying an outline built by `setMToonOutlines`' width override. */
  injected: number;
}

/** Upper bound for the width override; a hostile or mistaken value otherwise smears the whole frame. */
const MAX_OUTLINE_WIDTH = 0.05;

/** Width each outline clone had before this module first touched it. */
const authoredWidth = new WeakMap<MToonMaterial, number>();
/** Outline clones this module created, as opposed to ones the loader authored. */
const injectedOutlines = new WeakSet<MToonMaterial>();

interface SurfaceEntry {
  mesh: THREE.Mesh;
  surface: MToonMaterial;
  outline: MToonMaterial | null;
}

function forEachSurface(root: THREE.Object3D, fn: (entry: SurfaceEntry) => void): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    let surface: MToonMaterial | null = null;
    let outline: MToonMaterial | null = null;
    for (const mat of mats) {
      if (!(mat instanceof MToonMaterial)) continue;
      if (mat.isOutline) outline ??= mat;
      else surface ??= mat;
    }
    if (surface) fn({ mesh, surface, outline });
  });
}

/**
 * Build an outline for a mesh the loader left without one, the same way
 * three-vrm's `_generateOutline` does. Returns null when the mesh is not a
 * safe candidate.
 */
function injectOutline(mesh: THREE.Mesh, surface: MToonMaterial): MToonMaterial | null {
  // Transparent MToon surfaces are face details (lashes, brows, eye highlights);
  // an outline around them reads as a smudge, not a line.
  if (surface.transparent) return null;
  if (Array.isArray(mesh.material)) return null;
  const geometry = mesh.geometry;
  // Existing groups mean either another material layout or a geometry shared
  // with a mesh that already got groups; adding two more would break both.
  if (geometry.groups.length > 0) return null;

  const outline = surface.clone();
  outline.name += " (Outline)";
  outline.isOutline = true;
  outline.side = THREE.BackSide;
  if (outline.outlineWidthMode === "none") outline.outlineWidthMode = "worldCoordinates";

  const count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
  mesh.material = [surface, outline];
  geometry.addGroup(0, count, 0);
  geometry.addGroup(0, count, 1);

  injectedOutlines.add(outline);
  authoredWidth.set(outline, 0);
  return outline;
}

/**
 * countOutlinedMaterials - Count surface MToon materials under `root` and how
 * many carry an authored or injected outline. Based on which outline clones
 * exist, so the result does not change when outlines are hidden.
 *
 * @param root - Root object to traverse (e.g. a loaded VRM scene).
 * @returns Counts per unique surface material.
 */
export function countOutlinedMaterials(root: THREE.Object3D): OutlineCounts {
  const total = new Set<string>();
  const outlined = new Set<string>();
  const injected = new Set<string>();
  forEachSurface(root, ({ surface, outline }) => {
    total.add(surface.uuid);
    if (!outline) return;
    (injectedOutlines.has(outline) ? injected : outlined).add(surface.uuid);
  });
  return { total: total.size, outlined: outlined.size, injected: injected.size };
}

/**
 * setMToonOutlines - Show, hide or resize MToon outlines at runtime, with no reload.
 *
 * - `enabled === false` hides every outline. Hidden outline materials are
 *   skipped by the renderer, so their draw calls go away.
 * - `enabled === true` without `width` shows the asset's authored outlines at
 *   their authored width and hides any this module injected.
 * - `enabled === true` with `width` builds outlines for opaque surfaces that
 *   have none, then draws every outline at that width (clamped to 0–0.05).
 *
 * Non-cumulative: authored widths are snapshotted per outline before the first
 * write, and restore always reads the snapshot.
 *
 * @param root - Root object to traverse (e.g. a loaded VRM scene).
 * @param enabled - Whether outlines render.
 * @param width - Optional world-space width override.
 * @returns How many outline materials changed.
 */
export function setMToonOutlines(
  root: THREE.Object3D,
  enabled: boolean,
  width?: number,
): number {
  const override =
    width === undefined || !Number.isFinite(width)
      ? undefined
      : Math.min(MAX_OUTLINE_WIDTH, Math.max(0, width));
  let changed = 0;

  forEachSurface(root, ({ mesh, surface, outline }) => {
    let target = outline;
    if (!target && enabled && override !== undefined && override > 0) {
      target = injectOutline(mesh, surface);
    }
    if (!target) return;

    if (!authoredWidth.has(target)) authoredWidth.set(target, target.outlineWidthFactor);
    const isInjected = injectedOutlines.has(target);
    const nextWidth = override ?? authoredWidth.get(target)!;
    const nextVisible = enabled && nextWidth > 0 && (override !== undefined || !isInjected);

    if (target.visible !== nextVisible || target.outlineWidthFactor !== nextWidth) {
      target.visible = nextVisible;
      target.outlineWidthFactor = nextWidth;
      changed++;
    }
  });

  return changed;
}
