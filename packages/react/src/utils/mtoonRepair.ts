import * as THREE from "three";
import { MToonMaterial, MToonMaterialDebugMode } from "@pixiv/three-vrm";

/**
 * mtoonRepair - Graduated from `apps/playground/src/app/mtoon-spike/repairMToon.ts`
 * (spike 002, human-verified). A *repair* pass, not an override pass: it only
 * rewrites `MToonMaterial` values spike 001's runtime audit proved are broken
 * across real assets, and leaves everything a competent artist authored alone.
 * Every rule threshold below is backed by a measured fire-count in
 * `.planning/spikes/001-mtoon-runtime-audit/`.
 *
 * No `"use client"` directive — this module only imports `three` and
 * `@pixiv/three-vrm`, so it is importable from a headless/Node test (see
 * `mtoonRepair.test.ts`) without dragging in `@react-three/postprocessing` or
 * JSX, unlike `renderQuality.tsx`.
 */

/**
 * Materials whose flat / rim-less look is a deliberate anime convention, not a
 * defect — eyes, irises, highlights, lashes, eyelines, brows, mouth interiors.
 * Spike 001: 7/7 of `male.vrm`'s "unshaded" materials are these. Injecting
 * shading or rim light here paints shadows across irises and eye highlights,
 * which is strictly worse than doing nothing. Deliberately does NOT match
 * face SKIN (`..._Face_00_SKIN`), which should be repaired.
 */
export const FACE_DETAIL_MATERIAL_RE =
  /eye|iris|highlight|lash|eyeline|brow|mouth|tooth|teeth|tongue|face_?e|shadow/i;

/**
 * `"off"` disables the repair pass entirely (authored values render as-is).
 * `"repair"` runs the R1-R5 rules below.
 *
 * Deliberately does NOT include `"anime-premium"` — only `"off"` and
 * `"repair"` have spike evidence behind them (see Plan 03's decision block).
 * Additive-safe: a future preset can be appended to this union without
 * breaking existing callers who switch on it exhaustively, as long as they
 * also add a case for the new value.
 */
export type MaterialPreset = "off" | "repair";

/** Options for {@link repairMToonMaterials}. */
export interface RepairOptions {
  /** Strength of an injected rim light, 0-1. Default: 0.45 */
  rimStrength: number;
  /** `shadingToonyFactor` at or below this counts as "not toon at all". Default: 0.3 */
  toonyFloor: number;
  /** Value a too-soft `shadingToonyFactor` is raised to. Default: 0.75 */
  toonyTarget: number;
  /** `parametricRimFresnelPowerFactor` above this is treated as an invisible rim. Default: 20 */
  fresnelMax: number;
  /** Fresnel power used when clamping or when injecting a rim. Default: 5 */
  fresnelTarget: number;
}

/** Default repair thresholds, carried over verbatim from the validated spike. */
export const DEFAULT_REPAIR: RepairOptions = {
  rimStrength: 0.45,
  toonyFloor: 0.3,
  toonyTarget: 0.75,
  fresnelMax: 20,
  fresnelTarget: 5,
};

/** One rule application, recorded for diagnostics/debugging. */
export interface RepairLogEntry {
  material: string;
  /**
   * Exactly the five surviving rules (R5, R4, R3, R2, R1) — the two rules
   * spike 001 killed (`shadingShiftFactor < -0.5` with 0 hits across 78
   * materials, and `shadeColorFactor ≈ litFactor` which only ever fired on
   * deliberately-flat face-detail materials) are unrepresentable in this type.
   */
  rule: "R1-rim" | "R2-fresnel" | "R3-toony" | "R4-fully-lit" | "R5-range";
  before: string;
  after: string;
}

/** Result of a single {@link repairMToonMaterials} pass. */
export interface RepairResult {
  log: RepairLogEntry[];
  mtoonCount: number;
  skippedFaceDetail: number;
  touched: number;
}

/** Snapshot of the four fields {@link repairMToonMaterials} can mutate, keyed by material uuid. */
export type MToonSnapshot = Map<string, Record<string, unknown>>;

const isNearBlack = (c: THREE.Color) => c.r < 0.02 && c.g < 0.02 && c.b < 0.02;
const fmt = (c: THREE.Color) =>
  `[${c.r.toFixed(2)},${c.g.toFixed(2)},${c.b.toFixed(2)}]`;

function forEachMToon(root: THREE.Object3D, fn: (m: MToonMaterial) => void): void {
  const seen = new Set<string>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!(mat instanceof MToonMaterial)) continue;
      if (seen.has(mat.uuid)) continue;
      seen.add(mat.uuid);
      fn(mat);
    }
  });
}

/**
 * snapshotMToon - Capture the four fields {@link repairMToonMaterials} may
 * mutate, so `restoreMToon` can put a scene back to its authored values
 * exactly, at runtime, without a reload — this is what makes
 * `materialPreset="off"` toggleable after a model has already loaded.
 *
 * @param root - Root object to traverse (e.g. a loaded VRM scene).
 * @returns A snapshot keyed by material uuid.
 */
export function snapshotMToon(root: THREE.Object3D): MToonSnapshot {
  const snap: MToonSnapshot = new Map();
  forEachMToon(root, (m) => {
    snap.set(m.uuid, {
      shadingToonyFactor: m.shadingToonyFactor,
      shadingShiftFactor: m.shadingShiftFactor,
      parametricRimColorFactor: m.parametricRimColorFactor.clone(),
      parametricRimFresnelPowerFactor: m.parametricRimFresnelPowerFactor,
    });
  });
  return snap;
}

/**
 * restoreMToon - Restore every `MToonMaterial` under `root` to the values
 * captured by a prior {@link snapshotMToon} call.
 *
 * @param root - Root object to traverse (must be the same scene the snapshot
 *   was taken from — restoration is keyed by material uuid).
 * @param snap - A snapshot produced by {@link snapshotMToon}.
 */
export function restoreMToon(root: THREE.Object3D, snap: MToonSnapshot): void {
  forEachMToon(root, (m) => {
    const s = snap.get(m.uuid);
    if (!s) return;
    m.shadingToonyFactor = s.shadingToonyFactor as number;
    m.shadingShiftFactor = s.shadingShiftFactor as number;
    m.parametricRimColorFactor.copy(s.parametricRimColorFactor as THREE.Color);
    m.parametricRimFresnelPowerFactor = s.parametricRimFresnelPowerFactor as number;
    m.needsUpdate = true;
  });
}

/**
 * repairMToonMaterials - Apply the validated R1-R5 repair rules to every
 * `MToonMaterial` under `root`, in the order R5, R4, R3, R2, R1. Order is
 * load-bearing: R5 clamps out-of-range input before R3 reads it.
 *
 * The face-detail exclusion (MTOON-02) runs BEFORE any rule, per material,
 * so a face-detail material is never touched by any rule and is counted in
 * `skippedFaceDetail` instead of `log`/`touched`.
 *
 * @param root - Root object to traverse (e.g. a loaded VRM scene).
 * @param opts - Repair thresholds. Defaults to {@link DEFAULT_REPAIR}.
 * @returns A log of every rule firing plus summary counts.
 */
export function repairMToonMaterials(
  root: THREE.Object3D,
  opts: RepairOptions = DEFAULT_REPAIR,
): RepairResult {
  const log: RepairLogEntry[] = [];
  let mtoonCount = 0;
  let skippedFaceDetail = 0;
  const touchedIds = new Set<string>();

  forEachMToon(root, (m) => {
    mtoonCount++;
    if (FACE_DETAIL_MATERIAL_RE.test(m.name)) {
      skippedFaceDetail++;
      return;
    }
    const push = (rule: RepairLogEntry["rule"], before: string, after: string) => {
      log.push({ material: m.name, rule, before, after });
      touchedIds.add(m.uuid);
    };

    // R5 — `shadingToonyFactor` outside the spec's 0..1 range (1/19 on male.vrm).
    // Runs before R3 so an out-of-range value is normalised first.
    if (m.shadingToonyFactor < 0 || m.shadingToonyFactor > 1) {
      const before = m.shadingToonyFactor;
      m.shadingToonyFactor = THREE.MathUtils.clamp(before, 0, 1);
      push("R5-range", before.toFixed(4), m.shadingToonyFactor.toFixed(4));
    }

    // R4 — shift >= 0.5 saturates `shading` at 1, so the surface renders 100%
    // lit under every light direction (5/19 on male.vrm — all hair). Guarded
    // by `shadingShiftTexture`: a texture-driven shift can push the sampled
    // per-texel value up even when the flat factor reads low, and factor-only
    // inspection cannot see that (spike 001 caveat) — skip the rule rather
    // than repair a value we cannot actually observe.
    if (m.shadingShiftFactor >= 0.5 && !m.shadingShiftTexture) {
      const before = m.shadingShiftFactor;
      m.shadingShiftFactor = 0;
      push("R4-fully-lit", before.toFixed(4), "0.0000");
    }

    // R3 — a toony factor under the floor is a wide Lambert-ish ramp, not toon
    // shading at all (14/19 on male.vrm — the real cause of "our avatars look flat").
    if (m.shadingToonyFactor < opts.toonyFloor) {
      const before = m.shadingToonyFactor;
      m.shadingToonyFactor = opts.toonyTarget;
      push("R3-toony", before.toFixed(4), opts.toonyTarget.toFixed(4));
    }

    // R2 — an absurd fresnel power makes the rim razor-thin and invisible
    // (18/18 on 262410318834873893.vrm, which sets 100).
    if (m.parametricRimFresnelPowerFactor > opts.fresnelMax) {
      const before = m.parametricRimFresnelPowerFactor;
      m.parametricRimFresnelPowerFactor = opts.fresnelTarget;
      push("R2-fresnel", before.toFixed(2), opts.fresnelTarget.toFixed(2));
    }

    // R1 — a black rim colour means no rim light at all (19/19 and 18/18 on the
    // VRM 0.x assets). Skipped when a rimMultiplyTexture drives the rim, since
    // factor-only inspection cannot see texture-driven values (spike 001 caveat).
    if (isNearBlack(m.parametricRimColorFactor) && !m.rimMultiplyTexture) {
      const before = fmt(m.parametricRimColorFactor);
      // Derive the rim from the material's own lit colour so hue stays coherent
      // per-material, pushed toward white and scaled by strength.
      m.parametricRimColorFactor
        .copy(m.color)
        .lerp(new THREE.Color(1, 1, 1), 0.6)
        .multiplyScalar(opts.rimStrength);
      // TRAP (spike 002): a rim colour alone is not enough. male.vrm ships
      // parametricRimFresnelPowerFactor = 1 on every material; at power 1 the
      // Fresnel term covers the whole surface, so an injected rim colour
      // reads as a full-body wash, not an edge. Raising fresnel power here is
      // required, not optional, whenever we inject a rim colour.
      if (m.parametricRimFresnelPowerFactor < 2) {
        m.parametricRimFresnelPowerFactor = opts.fresnelTarget;
      }
      push("R1-rim", before, fmt(m.parametricRimColorFactor));
    }

    m.needsUpdate = true;
  });

  return { log, mtoonCount, skippedFaceDetail, touched: touchedIds.size };
}

/**
 * setMToonDebugMode - Toggle every `MToonMaterial` under `root` to a debug
 * visualization mode (or back to `"none"`) at runtime.
 *
 * `MToonMaterial`'s `debugMode` SETTER sets `needsUpdate = true` internally
 * (verified in `@pixiv/three-vrm-materials-mtoon@3.4.2` lib source, `set
 * debugMode`), which is why this works without re-loading the model through
 * `MToonMaterialLoaderPlugin`'s load-time `debugMode` option — assigning the
 * property alone is sufficient to force a shader recompile on next render.
 *
 * @param root - Root object to traverse (e.g. a loaded VRM scene).
 * @param mode - The debug visualization mode to apply to every material.
 * @returns The number of `MToonMaterial` instances touched.
 */
export function setMToonDebugMode(root: THREE.Object3D, mode: MToonMaterialDebugMode): number {
  let count = 0;
  forEachMToon(root, (m) => {
    m.debugMode = mode;
    count++;
  });
  return count;
}
