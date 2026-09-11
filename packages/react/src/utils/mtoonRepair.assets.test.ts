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
// header for the full explanation of why this workaround is safe here. Cast
// through `unknown` because Node's `globalThis` type has no `self` property
// and does not structurally satisfy DOM's `Window` type.
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

  it(
    "fires each rule on exactly the materials the spike 001 audit predicted",
    async () => {
      function tally(log: { rule: string }[]): Record<string, number> {
        const counts: Record<string, number> = {};
        for (const entry of log) {
          counts[entry.rule] = (counts[entry.rule] ?? 0) + 1;
        }
        return counts;
      }

      // BASELINE CORRECTION (documented as a Plan 15-02 finding, not a code
      // regression): the numbers below differ from the fire-count table in
      // `15-RESEARCH.md` §2, but match `.planning/spikes/001-mtoon-runtime-audit/audit-result.json`
      // (the committed ground-truth per-material audit, `_looksLikeFaceDetail`
      // flags) exactly, and were independently re-derived by hand-evaluating
      // `FACE_DETAIL_MATERIAL_RE` against every material name in that JSON.
      // Running the UNMODIFIED spike source
      // (`apps/playground/src/app/mtoon-spike/repairMToon.ts`, byte-identical
      // to before this phase) against these same committed `.vrm` files
      // reproduces these exact numbers too — and `git log --follow` on all
      // three asset files shows no changes since the initial commit. So this
      // is not asset drift and not a graduation regression: the RESEARCH.md
      // table's "shade ≈ lit" row (the face-detail proxy) undercounted by
      // exactly one material on every model (male.vrm: 7 claimed vs 8 actual
      // -- "M00_000_00_Face_00_SKIN" is correctly NOT face-detail and was
      // seemingly miscounted as one of the matches when the table was
      // written; 3636...vrm: 7 claimed vs 4 actual, matching the spike's own
      // verify-repair.mjs EXPECTED comment, which is annotated with a
      // hand-wavy "+" acknowledging it was never verified by regex; 262...vrm:
      // 6 claimed vs 7 actual). Every downstream "fires after exclusion"
      // number in the plan's baseline was computed as
      // `rawConditionCount - claimed_faceSkipped`, so the same off-by-one
      // propagates into R1/R3/R2. R4 and R5 are untouched (they don't overlap
      // face-detail materials on these assets) and match the plan's original
      // baseline exactly.
      // male.vrm
      {
        const scene = await loadVrmScene("male.vrm");
        const result = repairMToonMaterials(scene);
        const counts = tally(result.log);
        expect(counts["R5-range"] ?? 0).toBe(1);
        expect(counts["R4-fully-lit"] ?? 0).toBe(5);
        // Plan baseline: 14 (raw count of materials with shadingToonyFactor <
        // 0.3, BEFORE face-detail exclusion -- matches RESEARCH.md's raw
        // "toony < 0.3" row exactly). Actual R3 FIRE count after excluding
        // the 8 real face-detail materials: 14 - 8 = 6.
        expect(counts["R3-toony"] ?? 0).toBe(6);
        expect(counts["R2-fresnel"] ?? 0).toBe(0);
        // Plan baseline: 12 (computed as 19 - 7 using the undercounted
        // faceSkipped). Actual: 19 - 8 = 11.
        expect(counts["R1-rim"] ?? 0).toBe(11);
        // Plan baseline: 7. Actual (verified against audit-result.json's
        // `_looksLikeFaceDetail` flags): 8 -- FaceBrow, FaceMouth, EyeIris,
        // EyeHighlight, EyeWhite, FaceEyelash, FaceEyeline, EyeExtra_01.
        expect(result.skippedFaceDetail).toBe(8);
      }

      // 3636451243928341470.vrm — the non-regression control: success
      // criterion 2 is only meaningful because the pass provably DOES modify
      // this well-authored model (7/21 materials in spike 002's human review
      // -- that 7 was `touched`, a different count than `skippedFaceDetail`).
      {
        const scene = await loadVrmScene("3636451243928341470.vrm");
        const result = repairMToonMaterials(scene);
        // Plan baseline: 7 (the spike's own verify-repair.mjs EXPECTED
        // comment, annotated "eyes_shadow, face_e_a, + " -- an admittedly
        // incomplete hand count). Actual, matching FACE_DETAIL_MATERIAL_RE
        // evaluated against every material name in audit-result.json: 4
        // (face_eyes, eyes_hiligit, eyes_shadow, face_e_a).
        expect(result.skippedFaceDetail).toBe(4);
        expect(result.touched).toBeGreaterThanOrEqual(7);
      }

      // 262410318834873893.vrm
      {
        const scene = await loadVrmScene("262410318834873893.vrm");
        const result = repairMToonMaterials(scene);
        const counts = tally(result.log);
        // Plan baseline: 12 (computed as 18 - 6 using the undercounted
        // faceSkipped). Actual: 18 - 7 = 11.
        expect(counts["R2-fresnel"] ?? 0).toBe(11);
        // Plan baseline: 6. Actual: 7 (FaceMouth, EyeIris, EyeHighlight,
        // EyeWhite, FaceBrow, FaceEyelash, FaceEyeline -- all "(Instance)"
        // suffixed, matched by FACE_DETAIL_MATERIAL_RE all the same).
        expect(result.skippedFaceDetail).toBe(7);
      }
    },
    ASSET_TIMEOUT,
  );
});
