/**
 * mtoonOutlines.assets.test.ts — real-asset verification of MToon outline
 * counts and toggle behavior (OUTLINE-01, Plan 16-05).
 *
 * This test proves the 6/19 and 0/21 authored-outline counts stated in D-10's
 * revision by loading real `.vrm` files through the full `VRMLoaderPlugin` and
 * inspecting the materials three-vrm generated. The numbers come from
 * `.planning/spikes/001-mtoon-runtime-audit/audit-result.json` and are the
 * source of truth for "what outlines an asset actually carries" — not guessed,
 * not inferred from the asset filename, measured.
 *
 * Technique: mirrors `mtoonRepair.assets.test.ts` exactly — headless VRM
 * loading via texture stubs, `node:fs` imports, raised per-test timeout. See
 * that file's header for the full explanation of why this works and what its
 * caveat (texture-driven values invisible) is.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, MToonMaterial } from "@pixiv/three-vrm";
import { countOutlinedMaterials, setMToonOutlines } from "./mtoonOutlines";

// `GLTFLoader.parse()` dies on `self is not defined` in Node — see
// `mtoonRepair.assets.test.ts` for the full explanation.
(globalThis as unknown as { self: unknown }).self ??= globalThis;

const MODELS_DIR = fileURLToPath(
  new URL("../../../../apps/playground/public/models/", import.meta.url),
);

/**
 * Load a real `.vrm` file through the full `VRMLoaderPlugin` headlessly,
 * with all texture decoding stubbed out (image-less `THREE.Texture`
 * instances). Throws loudly with the resolved path when the asset is
 * missing — a silently-skipped invariant is worse than no invariant.
 */
async function loadVrmScene(file: string): Promise<THREE.Group> {
  const abs = `${MODELS_DIR}${file}`;
  if (!fs.existsSync(abs)) {
    throw new Error(`Missing test asset: ${abs}`);
  }
  const buf = fs.readFileSync(abs);

  const loader = new GLTFLoader();
  loader.register((parser) => {
    const stub = () => new THREE.Texture();
    parser.loadTexture = async () => stub();
    parser.loadTextureImage = async () => stub();
    parser.assignTexture = async (
      materialParams: Record<string, unknown>,
      mapName: string,
    ): Promise<THREE.Texture> => {
      const texture = stub();
      materialParams[mapName] = texture;
      return texture;
    };
    return { name: "HeadlessStubTextures" };
  });
  loader.register((parser) => new VRMLoaderPlugin(parser));

  const arrayBuffer = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  );
  const gltf = await loader.parseAsync(arrayBuffer, "");
  return gltf.scene;
}

/**
 * Collect all surface MToonMaterial instances under `root`, skipping
 * three-vrm's generated outline clones (`isOutline === true`). Used to capture
 * authored `outlineWidthFactor` values before suppression, so the
 * non-cumulative restore test can verify them exactly.
 */
function collectSurfaceMToons(root: THREE.Object3D): MToonMaterial[] {
  const seen = new Set<string>();
  const mats: MToonMaterial[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const meshMats = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const mat of meshMats) {
      if (!(mat instanceof MToonMaterial)) continue;
      if (mat.isOutline) continue;
      if (seen.has(mat.uuid)) continue;
      seen.add(mat.uuid);
      mats.push(mat);
    }
  });
  return mats;
}

const ASSET_TIMEOUT = 120_000;

describe("mtoonOutlines against real .vrm assets", () => {
  it(
    "male.vrm: 6 of 19 materials carry an authored outline",
    async () => {
      const scene = await loadVrmScene("male.vrm");
      const counts = countOutlinedMaterials(scene);
      // Sourced from `.planning/spikes/001-mtoon-runtime-audit/audit-result.json`
      // and Plan 16-05's D-10 revision — these are the two numbers that make
      // "respect-existing-only" true rather than plausible.
      expect(counts.total).toBe(19);
      expect(counts.outlined).toBe(6);
    },
    ASSET_TIMEOUT,
  );

  it(
    "3636451243928341470.vrm: 0 of 21 materials carry an authored outline",
    async () => {
      const scene = await loadVrmScene("3636451243928341470.vrm");
      const counts = countOutlinedMaterials(scene);
      // The well-authored control from Phase 15. Zero outlines means
      // `setMToonOutlines(scene, false)` must be a no-op (returns 0, mutates
      // nothing).
      expect(counts.total).toBe(21);
      expect(counts.outlined).toBe(0);
    },
    ASSET_TIMEOUT,
  );

  it(
    "male.vrm: setMToonOutlines(false) is effectively a no-op (all 6 outlined materials already have width 0)",
    async () => {
      const scene = await loadVrmScene("male.vrm");
      const mats = collectSurfaceMToons(scene);

      // FINDING (Task 2): spike 001's audit and live loading both show all 6
      // of male.vrm's outlined materials (outlineWidthMode !== "none") have
      // outlineWidthFactor === 0 — they carry the outline infrastructure but
      // the width is already zero. `setMToonOutlines(false)` therefore has
      // nothing to suppress (it only touches materials with width > 0), and
      // returns 0, not 6.
      const touchedCount = setMToonOutlines(scene, false);
      expect(touchedCount).toBe(0);

      // Verify all 6 outlined materials remain at width 0 (unchanged).
      let outlinedCount = 0;
      for (const m of mats) {
        if (m.outlineWidthMode !== "none") {
          outlinedCount++;
          expect(
            m.outlineWidthFactor,
            `${m.name} should remain at outlineWidthFactor === 0`,
          ).toBe(0);
        }
      }
      expect(outlinedCount).toBe(6);
    },
    ASSET_TIMEOUT,
  );

  it(
    "male.vrm: setMToonOutlines(true) is also a no-op (nothing was suppressed)",
    async () => {
      const scene = await loadVrmScene("male.vrm");
      const mats = collectSurfaceMToons(scene);

      // All 6 outlined materials start at width 0 (per the finding above).
      setMToonOutlines(scene, false); // no-op (returns 0)
      const restoredCount = setMToonOutlines(scene, true); // also no-op
      expect(restoredCount).toBe(0);

      // All 6 outlined materials remain at width 0.
      for (const m of mats) {
        if (m.outlineWidthMode !== "none") {
          expect(
            m.outlineWidthFactor,
            `${m.name} should still be at outlineWidthFactor === 0`,
          ).toBe(0);
        }
      }
    },
    ASSET_TIMEOUT,
  );

  it(
    "male.vrm: repeated toggling remains stable (all operations are no-ops on width-0 materials)",
    async () => {
      const scene = await loadVrmScene("male.vrm");
      const mats = collectSurfaceMToons(scene);

      // Cycle: suppress, restore, suppress again, restore again.
      // All operations are no-ops because all 6 outlined materials have
      // width 0.
      setMToonOutlines(scene, false);
      setMToonOutlines(scene, true);
      setMToonOutlines(scene, false);
      setMToonOutlines(scene, true);

      // All 6 outlined materials must still be at width 0 (unchanged).
      for (const m of mats) {
        if (m.outlineWidthMode !== "none") {
          expect(
            m.outlineWidthFactor,
            `${m.name} should still be at outlineWidthFactor === 0 after 4 toggles`,
          ).toBe(0);
        }
      }
    },
    ASSET_TIMEOUT,
  );

  it(
    "3636451243928341470.vrm: setMToonOutlines(false) is a no-op (returns 0, mutates nothing)",
    async () => {
      const scene = await loadVrmScene("3636451243928341470.vrm");
      const mats = collectSurfaceMToons(scene);

      // Capture every material's width before the call.
      const before = new Map<string, number>();
      for (const m of mats) {
        before.set(m.uuid, m.outlineWidthFactor);
      }

      const touchedCount = setMToonOutlines(scene, false);
      // An asset with no authored outlines → setMToonOutlines must return 0.
      expect(touchedCount).toBe(0);

      // Every material's width must be unchanged.
      for (const m of mats) {
        expect(
          m.outlineWidthFactor,
          `${m.name} should be unchanged (no outlines to suppress)`,
        ).toBe(before.get(m.uuid));
      }
    },
    ASSET_TIMEOUT,
  );
});
