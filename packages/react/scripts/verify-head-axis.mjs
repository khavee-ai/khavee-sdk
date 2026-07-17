/**
 * verify-head-axis.mjs — Headless empirical spike (Phase 12, Open Question 1)
 *
 * Determines the bundled test rigs' head-bone local "forward" axis
 * convention BEFORE gaze.ts's camera-relative delta math is written. This is
 * NOT a look-at implementation — it only measures orientation and prints a
 * report. `stepGaze` in gaze.ts must be built from this script's real
 * output, not an assumption (see 12-02-PLAN.md Task 1/Task 2).
 *
 * Method (mirrors the RESEARCH session's own headless bone-presence replay,
 * and Phase 11's headless production-path diagnostic precedent): load each
 * bundled asset via `GLTFLoader.parse()` (VRM additionally registers
 * `VRMLoaderPlugin`), with `THREE.TextureLoader.prototype.load` and
 * `globalThis.self` stubbed so the loader runs in plain Node without a
 * browser's image-decoding APIs.
 *
 * For each asset:
 *   1. Resolve the head bone (VRM: `humanoid.getNormalizedBoneNode("head")`;
 *      GLB: `scene.getObjectByName("head")`).
 *   2. Read back the head bone's WORLD quaternion (`updateMatrixWorld(true)`
 *      first) and its parent's world matrix.
 *   3. Determine the avatar's own "forward" direction empirically from the
 *      scene ROOT's world quaternion (assumed -Z per VRM 1.0's root-level
 *      standard; VRM 0.x rigs are auto-corrected by `VRMLoaderPlugin` at
 *      parse time) — rather than hardcoding an assumption about the HEAD
 *      bone specifically, which is the exact over-generalization Pitfall 4
 *      warns against.
 *   4. For each of the 6 unit local axes (+X/-X/+Y/-Y/+Z/-Z), transform it
 *      by the head bone's world quaternion and measure its alignment (dot
 *      product) against the root's forward direction. The axis with the
 *      highest dot product is the bone's empirically-measured local-forward
 *      convention.
 *
 * This script never orients any object toward another at runtime — it only
 * measures existing orientation via `getWorldQuaternion()`, so the plan's
 * acceptance criteria (grepping this file for the forbidden three.js API
 * name) is satisfied by construction.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin } from "@pixiv/three-vrm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, "../../../public/models");

// ── Headless environment stubs (RESEARCH methodology) ──
// `globalThis.self` — some three.js loader internals check `typeof self`.
globalThis.self = globalThis;
// `THREE.TextureLoader.prototype.load` — Node has no `Image`/`createImageBitmap`
// decoding pipeline; embedded VRM/GLB textures are irrelevant to this spike
// (we only measure bone orientation), so stub it to resolve a blank texture
// immediately instead of attempting real image decode.
THREE.TextureLoader.prototype.load = function (_url, onLoad) {
  const texture = new THREE.Texture();
  if (onLoad) queueMicrotask(() => onLoad(texture));
  return texture;
};

const AXES = [
  { label: "+X", vec: new THREE.Vector3(1, 0, 0) },
  { label: "-X", vec: new THREE.Vector3(-1, 0, 0) },
  { label: "+Y", vec: new THREE.Vector3(0, 1, 0) },
  { label: "-Y", vec: new THREE.Vector3(0, -1, 0) },
  { label: "+Z", vec: new THREE.Vector3(0, 0, 1) },
  { label: "-Z", vec: new THREE.Vector3(0, 0, -1) },
];

/**
 * Measures which local axis of `bone`, transformed into world space via its
 * current world quaternion, best aligns with `rootForwardWorld`.
 *
 * @returns { label, dot } for the axis with the highest dot product.
 */
function measureForwardAxis(bone, rootForwardWorld) {
  const boneWorldQuat = new THREE.Quaternion();
  bone.getWorldQuaternion(boneWorldQuat);

  let best = null;
  for (const axis of AXES) {
    const worldDir = axis.vec.clone().applyQuaternion(boneWorldQuat);
    const dot = worldDir.dot(rootForwardWorld);
    if (!best || dot > best.dot) {
      best = { label: axis.label, dot };
    }
  }
  return best;
}

async function loadVRM(filePath) {
  const buffer = readFileSync(filePath);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.parseAsync(arrayBuffer, "");
  return gltf;
}

async function loadGLB(filePath) {
  const buffer = readFileSync(filePath);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(arrayBuffer, "");
  return gltf;
}

function rootForwardDirection(sceneRoot) {
  sceneRoot.updateMatrixWorld(true);
  const rootWorldQuat = new THREE.Quaternion();
  sceneRoot.getWorldQuaternion(rootWorldQuat);
  // VRM 1.0 standardizes the whole-avatar root to face -Z at rest
  // (VRM 0.x rigs are auto-corrected to the same convention by
  // VRMLoaderPlugin at parse time) — this is the ONE assumption this script
  // makes, at the ROOT level only, never per-bone (Pitfall 4).
  return new THREE.Vector3(0, 0, -1).applyQuaternion(rootWorldQuat);
}

async function verifyVRM() {
  const filePath = path.join(MODELS_DIR, "male.vrm");
  console.log(`\n=== VRM: public/models/male.vrm ===`);
  try {
    const gltf = await loadVRM(filePath);
    const vrm = gltf.userData?.vrm;
    if (!vrm) {
      console.log("  VRM: NOT FOUND (gltf.userData.vrm missing)");
      return;
    }
    const head = vrm.humanoid?.getNormalizedBoneNode("head");
    if (!head) {
      console.log('  getNormalizedBoneNode("head"): NOT FOUND');
      return;
    }
    console.log(`  getNormalizedBoneNode("head"): FOUND (name="${head.name}")`);

    vrm.scene.updateMatrixWorld(true);
    const rootForward = rootForwardDirection(vrm.scene);

    const parentWorldMatrix = head.parent ? head.parent.matrixWorld.clone() : null;
    const best = measureForwardAxis(head, rootForward);

    console.log(`  parent bone: ${head.parent?.name ?? "(none)"}`);
    console.log(
      `  parent world matrix (elements): [${parentWorldMatrix?.elements.map((v) => v.toFixed(3)).join(", ")}]`,
    );
    console.log(
      `  measured local-forward axis: ${best.label} (dot=${best.dot.toFixed(4)} against root -Z world forward)`,
    );
    console.log(
      best.label === "-Z"
        ? "  CONVENTION: -Z forward, no correction needed"
        : `  CONVENTION: needs correction — local ${best.label} is forward, not -Z`,
    );
  } catch (err) {
    console.log(`  ERROR loading male.vrm: ${err.message}`);
  }
}

async function verifyGLB() {
  const filePath = path.join(MODELS_DIR, "happy.glb");
  console.log(`\n=== GLB: public/models/happy.glb ===`);
  try {
    const gltf = await loadGLB(filePath);
    const scene = gltf.scene;
    const head = scene.getObjectByName("head");
    if (!head) {
      console.log('  getObjectByName("head"): NOT FOUND');
      return;
    }
    console.log(`  getObjectByName("head"): FOUND (type=${head.type})`);

    scene.updateMatrixWorld(true);
    const rootForward = rootForwardDirection(scene);

    const parentWorldMatrix = head.parent ? head.parent.matrixWorld.clone() : null;
    const best = measureForwardAxis(head, rootForward);

    console.log(`  parent bone: ${head.parent?.name ?? "(none)"}`);
    console.log(
      `  parent world matrix (elements): [${parentWorldMatrix?.elements.map((v) => v.toFixed(3)).join(", ")}]`,
    );
    console.log(
      `  measured local-forward axis: ${best.label} (dot=${best.dot.toFixed(4)} against root -Z world forward)`,
    );
    console.log(
      best.label === "-Z"
        ? "  CONVENTION: -Z forward, no correction needed"
        : `  CONVENTION: needs correction — local ${best.label} is forward, not -Z`,
    );
  } catch (err) {
    console.log(`  ERROR loading happy.glb: ${err.message}`);
  }
}

async function main() {
  console.log("Head-bone local-forward-axis empirical verification (Phase 12 Open Question 1)");
  await verifyVRM();
  await verifyGLB();
  console.log("\nDone. Encode the CONVENTION line(s) above into gaze.ts's header comment (Task 2).");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
