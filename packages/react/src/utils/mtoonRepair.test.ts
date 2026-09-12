/**
 * mtoonRepair.test.ts — unit tests for the MTOON-03 fix: R1's injected rim
 * tint must come from the material's base texture average, not `litFactor`,
 * so a VRoid model with a white litFactor and a saturated base texture gets
 * a chromatic rim instead of the grey wash spike 003 measured
 * ([0,0,0] -> [0.45,0.45,0.45] on real assets). See
 * `.planning/spikes/003-tonemapping-toon/README.md` finding 5.
 *
 * All fixtures are built in-process (no asset loading here — Plan 02 owns
 * real assets): a bare `MToonMaterial` attached to a `Mesh` in a `Group`,
 * with `DataTexture` fixtures for the texture-sampling path.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MToonMaterial } from "@pixiv/three-vrm";
import {
  averageTextureColor,
  DEFAULT_REPAIR,
  repairMToonMaterials,
} from "./mtoonRepair";

function makeMaterialScene(material: MToonMaterial): THREE.Group {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  group.add(mesh);
  return group;
}

/** A 2x2 DataTexture where every texel is the given opaque RGBA byte tuple. */
function solidTexture(r: number, g: number, b: number, a = 255): THREE.DataTexture {
  const data = new Uint8Array([r, g, b, a, r, g, b, a, r, g, b, a, r, g, b, a]);
  return new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
}

describe("averageTextureColor", () => {
  it("returns null for a null texture", () => {
    expect(averageTextureColor(null)).toBeNull();
  });

  it("returns the exact colour of a uniform 2x2 pure-red DataTexture", () => {
    const tex = solidTexture(255, 0, 0, 255);
    const color = averageTextureColor(tex);
    expect(color).not.toBeNull();
    expect(color!.getHexString()).toBe("ff0000");
  });

  it("excludes fully transparent texels from the average", () => {
    const data = new Uint8Array([
      255, 0, 0, 255, // opaque red
      255, 0, 0, 255, // opaque red
      0, 255, 0, 0, // transparent green — must be excluded
      0, 0, 255, 0, // transparent blue — must be excluded
    ]);
    const tex = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
    const color = averageTextureColor(tex);
    expect(color).not.toBeNull();
    expect(color!.getHexString()).toBe("ff0000");
  });

  it("returns null when the texture has no image data (headless loader stub)", () => {
    const tex = new THREE.Texture();
    expect(averageTextureColor(tex)).toBeNull();
  });
});

describe("repairMToonMaterials — MTOON-03 chromatic rim", () => {
  it("injects a BLUE rim (not grey) when litFactor is white and the base texture is blue", () => {
    const material = new MToonMaterial({});
    material.name = "Test_CLOTH";
    material.parametricRimColorFactor = new THREE.Color(0, 0, 0);
    material.color = new THREE.Color(1, 1, 1); // VRoid litFactor case: white
    material.map = solidTexture(0, 0, 255, 255); // saturated blue base texture

    const scene = makeMaterialScene(material);
    repairMToonMaterials(scene, DEFAULT_REPAIR);

    const hsl = { h: 0, s: 0, l: 0 };
    material.parametricRimColorFactor.getHSL(hsl);
    expect(hsl.s).toBeGreaterThanOrEqual(0.35);
    // Blue hue is 240/360 = 0.6667.
    expect(Math.abs(hsl.h - 2 / 3)).toBeLessThanOrEqual(0.05);
  });

  it("still repairs (falls back to color) and logs R1-rim when map is null", () => {
    const material = new MToonMaterial({});
    material.name = "Test_CLOTH_NOMAP";
    material.parametricRimColorFactor = new THREE.Color(0, 0, 0);
    material.color = new THREE.Color(0, 0, 1); // blue litFactor, no texture
    material.map = null;

    const scene = makeMaterialScene(material);
    const result = repairMToonMaterials(scene, DEFAULT_REPAIR);

    expect(result.log.some((e) => e.rule === "R1-rim")).toBe(true);
  });

  it("skips a face-detail material entirely (zero log entries, skippedFaceDetail=1)", () => {
    const material = new MToonMaterial({});
    material.name = "F00_Face_Eye_Highlight";
    material.parametricRimColorFactor = new THREE.Color(0, 0, 0);
    material.color = new THREE.Color(1, 1, 1);
    material.map = solidTexture(0, 0, 255, 255);

    const scene = makeMaterialScene(material);
    const result = repairMToonMaterials(scene, DEFAULT_REPAIR);

    expect(result.log.length).toBe(0);
    expect(result.skippedFaceDetail).toBe(1);
  });
});

/**
 * The achromatic branch (`hsl.s < rimAchromaticThreshold`) shipped with no
 * coverage — caught by the Phase 15 code review as WR-02. It is the
 * safety-critical half of MTOON-03: it must NOT invent a hue on a
 * deliberately-grey material, but it must still leave a VISIBLE rim, which
 * for a pure-black base it previously did not (three.js reports s=0, l=0, so
 * the tint stayed [0,0,0] and R1 logged a repair it had not performed).
 */
describe("repairMToonMaterials — MTOON-03 achromatic rim (WR-02)", () => {
  it("leaves a VISIBLE rim on a pure-black base instead of no-opping at [0,0,0]", () => {
    const material = new MToonMaterial({});
    material.name = "Test_CLOTH_BLACK";
    material.parametricRimColorFactor = new THREE.Color(0, 0, 0);
    material.color = new THREE.Color(0, 0, 0); // genuinely black garment
    material.map = null;

    const scene = makeMaterialScene(material);
    const result = repairMToonMaterials(scene, DEFAULT_REPAIR);

    expect(result.log.some((e) => e.rule === "R1-rim")).toBe(true);
    // The actual regression: the rim must no longer be black.
    const rim = material.parametricRimColorFactor;
    expect(rim.r + rim.g + rim.b).toBeGreaterThan(0);
    // R1 must have done what it logged.
    const entry = result.log.find((e) => e.rule === "R1-rim")!;
    expect(entry.after).not.toBe(entry.before);
  });

  it("does NOT invent a hue on a mid-grey base (stays achromatic)", () => {
    const material = new MToonMaterial({});
    material.name = "Test_CLOTH_GREY";
    material.parametricRimColorFactor = new THREE.Color(0, 0, 0);
    material.color = new THREE.Color(1, 1, 1);
    material.map = solidTexture(128, 128, 128, 255); // deliberate grey

    const scene = makeMaterialScene(material);
    repairMToonMaterials(scene, DEFAULT_REPAIR);

    const hsl = { h: 0, s: 0, l: 0 };
    material.parametricRimColorFactor.getHSL(hsl);
    // Saturation must stay at/near zero — tinting a grey garment is the
    // failure this branch exists to prevent.
    expect(hsl.s).toBeLessThan(DEFAULT_REPAIR.rimAchromaticThreshold);
    // ...while still being visible.
    expect(hsl.l).toBeGreaterThan(0);
  });

  it("keeps a white base achromatic and visible", () => {
    const material = new MToonMaterial({});
    material.name = "Test_CLOTH_WHITE";
    material.parametricRimColorFactor = new THREE.Color(0, 0, 0);
    material.color = new THREE.Color(1, 1, 1);
    material.map = solidTexture(255, 255, 255, 255);

    const scene = makeMaterialScene(material);
    repairMToonMaterials(scene, DEFAULT_REPAIR);

    const hsl = { h: 0, s: 0, l: 0 };
    material.parametricRimColorFactor.getHSL(hsl);
    expect(hsl.s).toBeLessThan(DEFAULT_REPAIR.rimAchromaticThreshold);
    expect(hsl.l).toBeGreaterThan(0);
  });

  it("still raises fresnel power when injecting an achromatic rim (spike 002 trap)", () => {
    const material = new MToonMaterial({});
    material.name = "Test_CLOTH_BLACK_FRESNEL";
    material.parametricRimColorFactor = new THREE.Color(0, 0, 0);
    material.color = new THREE.Color(0, 0, 0);
    material.map = null;
    material.parametricRimFresnelPowerFactor = 1; // male.vrm's shipped value

    const scene = makeMaterialScene(material);
    repairMToonMaterials(scene, DEFAULT_REPAIR);

    // At power 1 the Fresnel term covers the whole surface, so an injected
    // rim reads as a full-body wash rather than an edge.
    expect(material.parametricRimFresnelPowerFactor).toBe(DEFAULT_REPAIR.fresnelTarget);
  });
});
