/**
 * Spike 001 — MToon runtime audit.
 *
 * Question: what do MToon material properties ACTUALLY look like at runtime,
 * after `VRMMaterialsV0CompatPlugin` has converted VRM 0.x `materialProperties`
 * into VRM 1.0 parameters? The repair-pass detection thresholds were drafted
 * from raw values read out of the .vrm file — but v0compat rewrites several of
 * them with non-trivial math, so file values are NOT what the pass will see.
 *
 * Loads through the SAME path VRMAvatar.tsx uses (GLTFLoader.parse + the full
 * VRMLoaderPlugin, not VRMCoreLoaderPlugin) so the MToon materials are real.
 */
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin } from "@pixiv/three-vrm";

globalThis.self ??= globalThis;

const MODELS_DIR = path.resolve("apps/playground/public/models");
const TARGETS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["male.vrm", "3636451243928341470.vrm", "262410318834873893.vrm", "amongus.vrm"];

const c3 = (c) => (c ? [c.r, c.g, c.b].map((x) => +x.toFixed(3)) : null);
const isNearBlack = (c) => c && c.r < 0.02 && c.g < 0.02 && c.b < 0.02;
const FACE_DETAIL_RE =
  /eye|iris|highlight|lash|eyeline|brow|mouth|tooth|teeth|tongue|face_?e|shadow/i;
const nearEq = (a, b, eps = 0.02) =>
  a && b && Math.abs(a.r - b.r) < eps && Math.abs(a.g - b.g) < eps && Math.abs(a.b - b.b) < eps;

async function auditModel(file) {
  const buf = fs.readFileSync(path.join(MODELS_DIR, file));
  const loader = new GLTFLoader();
  // Node has no DOM image pipeline, so GLTFLoader's texture path dies on
  // `self is not defined` (GLTFLoader.js:3377) — this is the "MToon-material
  // Node crash" Phase 11 worked around by falling back to VRMCoreLoaderPlugin.
  // It is NOT an MToon problem: it is image decoding. Stubbing the texture
  // pipeline lets the FULL VRMLoaderPlugin (MToon included) run headless.
  // Caveat: texture-multiplied MToon slots (shadeMultiplyTexture,
  // rimMultiplyTexture, shadingShiftTexture) are therefore NOT reflected here
  // — this audit covers scalar/color factors only.
  loader.register((parser) => {
    // Return real (but image-less) THREE.Texture objects rather than null:
    // three-vrm's GLTFMToonMaterialParamsAssignHelper calls
    // setTextureColorSpace(materialParams[slot]) straight after assigning,
    // which throws on undefined.
    const stubTexture = () => new THREE.Texture();
    parser.loadTexture = async () => stubTexture();
    parser.loadTextureImage = async () => stubTexture();
    parser.assignTexture = async (materialParams, mapName) => {
      const t = stubTexture();
      materialParams[mapName] = t;
      return t;
    };
    return { name: "SpikeStubTextures" };
  });
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.parseAsync(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    "",
  );

  const mats = new Map();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m) mats.set(m.uuid, m);
    }
  });

  const rows = [];
  for (const m of mats.values()) {
    if (m.constructor.name !== "MToonMaterial") {
      rows.push({ name: m.name, type: m.constructor.name, mtoon: false });
      continue;
    }
    rows.push({
      name: m.name,
      type: m.constructor.name,
      mtoon: true,
      lit: c3(m.color),
      shade: c3(m.shadeColorFactor),
      toony: +m.shadingToonyFactor?.toFixed(4),
      shift: +m.shadingShiftFactor?.toFixed(4),
      gi: +m.giEqualizationFactor?.toFixed(3),
      rimColor: c3(m.parametricRimColorFactor),
      rimMix: +m.rimLightingMixFactor?.toFixed(3),
      rimFresnel: +m.parametricRimFresnelPowerFactor?.toFixed(2),
      rimLift: +m.parametricRimLiftFactor?.toFixed(3),
      outlineMode: m.outlineWidthMode,
      outlineWidth: +m.outlineWidthFactor?.toFixed(5),
      // ── diagnosis flags ────────────────────────────────────────────
      // Refined after the first audit run (see README Investigation Trail):
      // rim is killed by a BLACK rim color, not by rimLightingMixFactor — per
      // spec, mix=0 means "rim is pure emission" (MORE visible), mix=1 means
      // "rim is multiplied by lighting". The original draft rule had this
      // backwards.
      _rimDead: isNearBlack(m.parametricRimColorFactor),
      _fresnelAbsurd: m.parametricRimFresnelPowerFactor > 20,
      _toonyOutOfRange: m.shadingToonyFactor < 0 || m.shadingToonyFactor > 1,
      _toonyTooSoft: m.shadingToonyFactor < 0.3,
      // shift >= +1 collapses linearstep's range to zero AND pushes every
      // dot(N,L) above the threshold => surface renders 100% lit, never shaded.
      _shiftFullyLit: m.shadingShiftFactor >= 0.5,
      _shiftExtremeNegative: m.shadingShiftFactor < -0.5,
      _flatNoShade: nearEq(m.color, m.shadeColorFactor),
      // Anime convention: eyes/lashes/brows/mouth details are DELIBERATELY
      // unshaded. A flat shadeColor on these is correct authoring, not a bug.
      _looksLikeFaceDetail: FACE_DETAIL_RE.test(String(m.name)),
    });
  }
  return rows;
}

const out = {};
for (const f of TARGETS) {
  process.stdout.write(`\n━━━ ${f} ━━━\n`);
  try {
    const rows = await auditModel(f);
    out[f] = rows;
    const mt = rows.filter((r) => r.mtoon);
    console.log(`  materials: ${rows.length}  (MToon: ${mt.length})`);
    for (const r of mt) {
      const flags = Object.entries(r)
        .filter(([k, v]) => k.startsWith("_") && v)
        .map(([k]) => k.slice(1));
      console.log(
        `  ${String(r.name).slice(0, 22).padEnd(23)}` +
          `toony=${String(r.toony).padStart(7)} shift=${String(r.shift).padStart(8)} ` +
          `gi=${String(r.gi).padStart(5)} rimMix=${String(r.rimMix).padStart(5)} ` +
          `fres=${String(r.rimFresnel).padStart(6)} ` +
          `shade=[${r.shade}] rim=[${r.rimColor}]` +
          (flags.length ? `\n${" ".repeat(25)}⚑ ${flags.join(", ")}` : ""),
      );
    }
  } catch (e) {
    out[f] = { error: String(e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n") : e) };
    console.log(`  ✗ LOAD FAILED: ${e?.message ?? e}`);
    if (e?.stack) console.log("    " + e.stack.split("\n").slice(1, 4).join("\n    "));
  }
}
// ── Aggregate summary ───────────────────────────────────────────────
console.log("\n\n━━━ RULE FIRE COUNTS (materials affected / total MToon) ━━━\n");
const RULES = [
  "rimDead", "fresnelAbsurd", "toonyOutOfRange", "toonyTooSoft",
  "shiftFullyLit", "shiftExtremeNegative", "flatNoShade",
];
const hdr = "model".padEnd(28) + RULES.map((r) => r.slice(0, 9).padStart(10)).join("");
console.log(hdr + "\n" + "-".repeat(hdr.length));
for (const [file, rows] of Object.entries(out)) {
  if (!Array.isArray(rows)) { console.log(file.padEnd(28) + "  LOAD FAILED"); continue; }
  const mt = rows.filter((r) => r.mtoon);
  const cells = RULES.map((r) => `${mt.filter((x) => x["_" + r]).length}/${mt.length}`.padStart(10));
  console.log(file.slice(0, 27).padEnd(28) + cells.join(""));
}
console.log("\n━━━ flatNoShade breakdown: face-detail (expected) vs body (suspicious) ━━━\n");
for (const [file, rows] of Object.entries(out)) {
  if (!Array.isArray(rows)) continue;
  const flat = rows.filter((r) => r.mtoon && r._flatNoShade);
  const faceish = flat.filter((r) => r._looksLikeFaceDetail);
  const body = flat.filter((r) => !r._looksLikeFaceDetail);
  console.log(
    file.slice(0, 27).padEnd(28) +
      `flat=${String(flat.length).padStart(2)}  faceDetail=${String(faceish.length).padStart(2)}  ` +
      `BODY=${String(body.length).padStart(2)}` +
      (body.length ? `  -> ${body.map((r) => r.name).join(", ")}` : ""),
  );
}

fs.writeFileSync(
  path.resolve(".planning/spikes/001-mtoon-runtime-audit/audit-result.json"),
  JSON.stringify(out, null, 2),
);
console.log("\n→ wrote audit-result.json");
