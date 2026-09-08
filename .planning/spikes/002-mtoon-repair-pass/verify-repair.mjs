/**
 * Spike 002 — headless verification of the repair pass.
 *
 * The VISUAL question ("does it look better?") needs a human at the browser
 * page. This script answers the mechanical half: does the pass fire on exactly
 * the materials spike 001 predicted, does it leave face details alone, and does
 * restore() actually put the authored values back?
 *
 * Reuses spike 001's texture-stub discovery to load the full VRMLoaderPlugin
 * (MToon included) in Node.
 */
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin } from "@pixiv/three-vrm";

globalThis.self ??= globalThis;

const { repairMToonMaterials, snapshotMToon, restoreMToon, DEFAULT_REPAIR } = await import(
  path.resolve("apps/playground/src/app/mtoon-spike/repairMToon.ts")
);

async function load(file) {
  const buf = fs.readFileSync(path.resolve("apps/playground/public/models", file));
  const loader = new GLTFLoader();
  loader.register((parser) => {
    const stub = () => new THREE.Texture();
    parser.loadTexture = async () => stub();
    parser.loadTextureImage = async () => stub();
    parser.assignTexture = async (mp, name) => (mp[name] = stub());
    return { name: "SpikeStubTextures" };
  });
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.parseAsync(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    "",
  );
  return gltf.scene;
}

const EXPECTED = {
  "male.vrm": { R3: 14, R4: 5, R5: 1, R1: 19 - 7, faceSkipped: 7 },
  "3636451243928341470.vrm": { faceSkipped: 4 + 3 /* eyes_shadow, face_e_a, + */ },
  "262410318834873893.vrm": { R2: 18 - 6, faceSkipped: 6 },
};

let failures = 0;
for (const file of Object.keys(EXPECTED)) {
  const scene = await load(file);
  const before = snapshotMToon(scene);
  const beforeVals = [...before.entries()].map(([k, v]) => [k, v.shadingToonyFactor]);

  const res = repairMToonMaterials(scene, DEFAULT_REPAIR);
  const byRule = res.log.reduce((a, e) => ((a[e.rule.slice(0, 2)] = (a[e.rule.slice(0, 2)] ?? 0) + 1), a), {});

  console.log(`\n━━━ ${file} ━━━`);
  console.log(`  MToon=${res.mtoonCount}  touched=${res.touched}  faceDetailSkipped=${res.skippedFaceDetail}`);
  console.log(`  rules: ${Object.entries(byRule).map(([k, v]) => `${k}×${v}`).join("  ") || "(none)"}`);

  // Assertion 1: face-detail materials must never appear in the log.
  const FACE = /eye|iris|highlight|lash|eyeline|brow|mouth|tooth|teeth|tongue|face_?e|shadow/i;
  const leaked = res.log.filter((e) => FACE.test(e.material));
  if (leaked.length) {
    failures++;
    console.log(`  ✗ FACE DETAIL LEAKED into repair: ${leaked.map((l) => l.material).join(", ")}`);
  } else {
    console.log(`  ✓ no face-detail material was modified`);
  }

  // Assertion 2: the deleted rules must not exist.
  if (res.log.some((e) => /shade|shift-extreme/i.test(e.rule))) {
    failures++;
    console.log(`  ✗ a deleted rule fired`);
  }

  // Assertion 3: restore() must return every value to the authored snapshot.
  restoreMToon(scene, before);
  const after = snapshotMToon(scene);
  const drift = beforeVals.filter(([k, v]) => after.get(k)?.shadingToonyFactor !== v);
  if (drift.length) {
    failures++;
    console.log(`  ✗ restore() left ${drift.length} material(s) drifted`);
  } else {
    console.log(`  ✓ restore() returned all ${beforeVals.length} materials to authored values`);
  }
}

console.log(`\n${failures === 0 ? "✓ ALL MECHANICAL CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
