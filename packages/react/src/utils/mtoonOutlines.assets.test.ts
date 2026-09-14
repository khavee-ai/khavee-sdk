/**
 * mtoonOutlines.assets.test.ts — real-asset verification of MToon outline
 * counts, visibility toggling and the width override (OUTLINE-01).
 *
 * Expected counts come from `.planning/spikes/001-mtoon-runtime-audit/audit-result.json`
 * read through three-vrm's own generation rule (mode !== "none" AND width > 0):
 * `male.vrm` sets a mode on 6 materials but authors width 0, so nothing is
 * generated; `262410318834873893.vrm` is the only test asset with real outlines.
 *
 * Technique: mirrors `mtoonRepair.assets.test.ts` — headless VRM loading via
 * texture stubs, `node:fs` imports, raised per-test timeout.
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

interface OutlineEntry {
  mesh: THREE.Mesh;
  surface: MToonMaterial;
  outline: MToonMaterial;
}

function collectOutlines(root: THREE.Object3D): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !Array.isArray(mesh.material)) return;
    const surface = mesh.material.find(
      (m): m is MToonMaterial => m instanceof MToonMaterial && !m.isOutline,
    );
    const outline = mesh.material.find(
      (m): m is MToonMaterial => m instanceof MToonMaterial && m.isOutline,
    );
    if (surface && outline) out.push({ mesh, surface, outline });
  });
  return out;
}

const ASSET_TIMEOUT = 120_000;
const OUTLINED_ASSET = "262410318834873893.vrm";

describe("mtoonOutlines against real .vrm assets", () => {
  it(
    "counts only the outlines three-vrm actually generated",
    async () => {
      expect(countOutlinedMaterials(await loadVrmScene("male.vrm"))).toEqual({
        total: 19,
        outlined: 0,
        injected: 0,
      });
      expect(
        countOutlinedMaterials(await loadVrmScene("3636451243928341470.vrm")),
      ).toEqual({ total: 21, outlined: 0, injected: 0 });
      const outlinedScene = await loadVrmScene(OUTLINED_ASSET);
      expect(countOutlinedMaterials(outlinedScene)).toEqual({
        total: 13,
        outlined: 5,
        injected: 0,
      });

      // Spike 001's audit reports 18 materials / 10 outlined for this asset. It
      // counted three-vrm's outline clones as materials: 13 surfaces + 5 clones,
      // and 5 outlined surfaces + their 5 clones (clones copy mode and width).
      const all = new Map<string, MToonMaterial>();
      outlinedScene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (m instanceof MToonMaterial) all.set(m.uuid, m);
        }
      });
      const mats = [...all.values()];
      expect(mats).toHaveLength(18);
      expect(
        mats.filter((m) => m.outlineWidthMode !== "none" && m.outlineWidthFactor > 0),
      ).toHaveLength(10);
    },
    ASSET_TIMEOUT * 3,
  );

  it(
    `${OUTLINED_ASSET}: hiding and restoring acts on the drawn outline clone, non-cumulatively`,
    async () => {
      const scene = await loadVrmScene(OUTLINED_ASSET);
      const entries = collectOutlines(scene);
      expect(entries.length).toBeGreaterThan(0);
      const authored = new Map(entries.map((e) => [e.outline, e.outline.outlineWidthFactor]));

      expect(setMToonOutlines(scene, false)).toBe(entries.length);
      for (const { outline } of entries) {
        expect(outline.visible).toBe(false);
      }

      for (const enabled of [true, false, true]) setMToonOutlines(scene, enabled);
      for (const { outline } of entries) {
        expect(outline.visible).toBe(true);
        expect(outline.outlineWidthFactor).toBe(authored.get(outline));
      }

      setMToonOutlines(scene, true, 0.003);
      for (const { outline } of entries) expect(outline.outlineWidthFactor).toBe(0.003);
      setMToonOutlines(scene, true);
      for (const { outline } of entries) {
        expect(outline.outlineWidthFactor).toBe(authored.get(outline));
      }
    },
    ASSET_TIMEOUT,
  );

  it(
    "male.vrm: a width override builds outlines the asset never authored",
    async () => {
      const scene = await loadVrmScene("male.vrm");
      expect(setMToonOutlines(scene, false)).toBe(0);
      expect(collectOutlines(scene)).toHaveLength(0);

      setMToonOutlines(scene, true, 0.003);
      const entries = collectOutlines(scene);
      const counts = countOutlinedMaterials(scene);
      expect(counts.injected).toBeGreaterThan(0);
      expect(counts.outlined).toBe(0);

      for (const { mesh, surface, outline } of entries) {
        expect(surface.transparent).toBe(false);
        expect(outline.side).toBe(THREE.BackSide);
        expect(outline.outlineWidthMode).not.toBe("none");
        expect(outline.outlineWidthFactor).toBe(0.003);
        expect(outline.visible).toBe(true);
        expect(mesh.material).toHaveLength(2);
        expect(mesh.geometry.groups).toHaveLength(2);
      }

      setMToonOutlines(scene, true, 0.003);
      expect(collectOutlines(scene)).toHaveLength(entries.length);
      expect(countOutlinedMaterials(scene)).toEqual(counts);

      setMToonOutlines(scene, true);
      for (const { outline } of entries) expect(outline.visible).toBe(false);
      setMToonOutlines(scene, false, 0.003);
      for (const { outline } of entries) expect(outline.visible).toBe(false);
    },
    ASSET_TIMEOUT,
  );

  it(
    "3636451243928341470.vrm: nothing changes without a width, and the override is clamped",
    async () => {
      const scene = await loadVrmScene("3636451243928341470.vrm");
      expect(setMToonOutlines(scene, false)).toBe(0);
      expect(setMToonOutlines(scene, true)).toBe(0);
      expect(collectOutlines(scene)).toHaveLength(0);

      setMToonOutlines(scene, true, 1);
      const entries = collectOutlines(scene);
      expect(entries.length).toBeGreaterThan(0);
      for (const { outline } of entries) expect(outline.outlineWidthFactor).toBe(0.05);
    },
    ASSET_TIMEOUT,
  );
});
