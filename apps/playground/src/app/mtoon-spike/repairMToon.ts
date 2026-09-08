/**
 * repairMToon.ts — SPIKE 002 (throwaway; lives under apps/playground so it can
 * actually render). If validated, this graduates into
 * `packages/react/src/utils/renderQuality.tsx`.
 *
 * A *repair* pass, not an override pass: it only rewrites MToon values that
 * spike 001's runtime audit proved are broken across real assets, and leaves
 * everything a competent artist set alone. Every rule threshold below is
 * backed by a measured fire-count in `.planning/spikes/001-mtoon-runtime-audit/`.
 */
import * as THREE from "three";
import { MToonMaterial } from "@pixiv/three-vrm";

/**
 * Materials whose flat / rim-less look is a deliberate anime convention, not a
 * defect — eyes, irises, highlights, lashes, eyelines, brows, mouth interiors.
 * Spike 001: 7/7 of `male.vrm`'s "unshaded" materials are these. Injecting
 * shading or rim light here paints shadows across irises and eye highlights,
 * which is strictly worse than doing nothing. Note this deliberately does NOT
 * match face SKIN (`..._Face_00_SKIN`), which should be repaired.
 */
const FACE_DETAIL_RE =
  /eye|iris|highlight|lash|eyeline|brow|mouth|tooth|teeth|tongue|face_?e|shadow/i;

export interface RepairOptions {
  /** Strength of an injected rim light, 0-1. Default 0.45 */
  rimStrength: number;
  /** `shadingToonyFactor` at or below this counts as "not toon at all". Default 0.3 */
  toonyFloor: number;
  /** Value a too-soft `shadingToonyFactor` is raised to. Default 0.75 */
  toonyTarget: number;
  /** `parametricRimFresnelPowerFactor` above this is treated as an invisible rim. Default 20 */
  fresnelMax: number;
  /** Fresnel power used when clamping or when injecting a rim. Default 5 */
  fresnelTarget: number;
}

export const DEFAULT_REPAIR: RepairOptions = {
  rimStrength: 0.45,
  toonyFloor: 0.3,
  toonyTarget: 0.75,
  fresnelMax: 20,
  fresnelTarget: 5,
};

export interface RepairLogEntry {
  material: string;
  rule: "R1-rim" | "R2-fresnel" | "R3-toony" | "R4-fully-lit" | "R5-range";
  before: string;
  after: string;
}

export interface RepairResult {
  log: RepairLogEntry[];
  mtoonCount: number;
  skippedFaceDetail: number;
  touched: number;
}

const isNearBlack = (c: THREE.Color) => c.r < 0.02 && c.g < 0.02 && c.b < 0.02;
const fmt = (c: THREE.Color) =>
  `[${c.r.toFixed(2)},${c.g.toFixed(2)},${c.b.toFixed(2)}]`;

/** Snapshot enough state to restore a material to its authored values. */
export type MToonSnapshot = Map<string, Record<string, unknown>>;

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
    if (FACE_DETAIL_RE.test(m.name)) {
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
    // lit under every light direction (5/19 on male.vrm — all hair).
    if (m.shadingShiftFactor >= 0.5) {
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
      // A rim colour alone is not enough: male.vrm ships fresnelPower = 1 on
      // every material, which spreads the "rim" across the whole surface and
      // reads as a wash, not an edge. Injecting a rim therefore also needs a
      // sane fresnel power.
      if (m.parametricRimFresnelPowerFactor < 2) {
        m.parametricRimFresnelPowerFactor = opts.fresnelTarget;
      }
      push("R1-rim", before, fmt(m.parametricRimColorFactor));
    }

    m.needsUpdate = true;
  });

  return { log, mtoonCount, skippedFaceDetail, touched: touchedIds.size };
}
