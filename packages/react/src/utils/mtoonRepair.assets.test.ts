/**
 * mtoonRepair.assets.test.ts — real-asset regression suite for the MToon
 * repair pass (TEST-01, success criterion 3).
 *
 * This is a SEPARATE file from `mtoonRepair.test.ts` (Plan 01's synthetic
 * unit tests) on purpose: these tests import `node:fs` and parse ~50 MB of
 * real `.vrm` GLB assets, which needs a raised per-test timeout. Keeping them
 * apart means the fast synthetic suite stays fast, and every node-only import
 * lives in one clearly-named file.
 *
 * Technique: `11-11-SUMMARY.md` concluded that loading a full VRM headlessly
 * in Node was impossible. Spike 001 (`.planning/spikes/001-mtoon-runtime-audit/`)
 * proved that claim is true only for TEXTURE DECODING — `GLTFLoader.parse()`
 * dies on `self is not defined` in Node, and three-vrm's MToon params helper
 * then dies on `setTextureColorSpace(undefined)`. Registering a plugin ahead
 * of `VRMLoaderPlugin` that returns image-less `new THREE.Texture()` objects
 * from `loadTexture`, `loadTextureImage` and `assignTexture` (plus
 * `globalThis.self ??= globalThis`) runs the FULL `VRMLoaderPlugin` — MToon
 * materials included — entirely in Node. The materials-skipping "core"
 * loader-plugin variant is NOT an acceptable fallback here: it would make
 * every assertion below vacuously pass against zero materials (see the
 * `mtoonCount` canary test).
 *
 * CAVEAT (carried over from spike 001/CONVENTIONS.md): texture-driven
 * material values (including `m.map`'s actual pixel contents) are invisible
 * under this stub — every stubbed texture is image-less, so
 * `averageTextureColor` returns `null` for every material here and R1 always
 * falls back to `m.color` (litFactor). This is why the chromatic-rim
 * assertion (MTOON-03: does a coloured base texture actually produce a
 * coloured rim) lives in `mtoonRepair.test.ts` against a synthetic
 * `DataTexture` instead of here — a real-asset test cannot exercise that path
 * at all under the headless stub.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin } from "@pixiv/three-vrm";
import {
  repairMToonMaterials,
  snapshotMToon,
  restoreMToon,
  DEFAULT_REPAIR,
  FACE_DETAIL_MATERIAL_RE,
} from "./mtoonRepair";

// `GLTFLoader.parse()` dies on `self is not defined` in Node — see the file
// header for the full explanation of why this workaround is safe here.
globalThis.self ??= globalThis;

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
    ) => {
      materialParams[mapName] = stub();
      return materialParams[mapName];
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

const ASSET_TIMEOUT = 120_000;

describe("mtoonRepair against real .vrm assets", () => {
  it(
    "never modifies a face-detail material",
    async () => {
      for (const file of [
        "male.vrm",
        "3636451243928341470.vrm",
        "262410318834873893.vrm",
      ]) {
        const scene = await loadVrmScene(file);
        const result = repairMToonMaterials(scene);
        const leaked = result.log.filter((e) =>
          FACE_DETAIL_MATERIAL_RE.test(e.material),
        );
        expect(
          leaked,
          `${file}: face-detail material(s) leaked into repair: ${leaked
            .map((l) => l.material)
            .join(", ")}`,
        ).toEqual([]);
      }
    },
    ASSET_TIMEOUT,
  );

  it(
    "only ever logs one of the five surviving rules",
    async () => {
      const ALLOWED_RULES = new Set([
        "R1-rim",
        "R2-fresnel",
        "R3-toony",
        "R4-fully-lit",
        "R5-range",
      ]);
      for (const file of [
        "male.vrm",
        "3636451243928341470.vrm",
        "262410318834873893.vrm",
      ]) {
        const scene = await loadVrmScene(file);
        const result = repairMToonMaterials(scene);
        for (const entry of result.log) {
          expect(
            ALLOWED_RULES.has(entry.rule),
            `${file}: unexpected rule "${entry.rule}" fired on "${entry.material}" — the deleted rules (shade ≈ lit, shift < -0.5) must never fire`,
          ).toBe(true);
        }
      }
    },
    ASSET_TIMEOUT,
  );

  it(
    "restores every snapshotted field exactly",
    async () => {
      const scene = await loadVrmScene("male.vrm");
      const before = snapshotMToon(scene);
      expect(before.size).toBeGreaterThan(0);

      const result = repairMToonMaterials(scene, DEFAULT_REPAIR);
      // The repair actually happened, so restore is a real test, not a no-op.
      expect(result.touched).toBeGreaterThan(0);

      restoreMToon(scene, before);
      const after = snapshotMToon(scene);

      expect(after.size).toBe(before.size);
      for (const [uuid, beforeFields] of before) {
        const afterFields = after.get(uuid);
        expect(afterFields, `material ${uuid} missing after restore`).toBeDefined();

        expect(afterFields!.shadingToonyFactor).toBe(beforeFields.shadingToonyFactor);
        expect(afterFields!.shadingShiftFactor).toBe(beforeFields.shadingShiftFactor);
        expect(afterFields!.parametricRimFresnelPowerFactor).toBe(
          beforeFields.parametricRimFresnelPowerFactor,
        );
        expect(
          (afterFields!.parametricRimColorFactor as THREE.Color).getHex(),
        ).toBe((beforeFields.parametricRimColorFactor as THREE.Color).getHex());
      }
    },
    ASSET_TIMEOUT,
  );

  it(
    "finds MToon materials at all",
    async () => {
      const EXPECTED_MTOON_COUNT: Record<string, number> = {
        "male.vrm": 19,
        "3636451243928341470.vrm": 21,
        "262410318834873893.vrm": 18,
      };
      for (const [file, expected] of Object.entries(EXPECTED_MTOON_COUNT)) {
        const scene = await loadVrmScene(file);
        const result = repairMToonMaterials(scene);
        // Canary: if the texture stub ever silently degrades to the
        // materials-skipping "core" loader-plugin behaviour, mtoonCount
        // drops to 0 and every other assertion in this file would
        // vacuously pass.
        expect(result.mtoonCount, `${file}: mtoonCount mismatch`).toBe(expected);
      }
    },
    ASSET_TIMEOUT,
  );
});
