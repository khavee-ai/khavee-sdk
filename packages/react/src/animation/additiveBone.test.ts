/**
 * additiveBone.test.ts — unit tests for the non-accumulating additive bone
 * write helper (P18-ACC). Exercises `applyAdditiveDelta`/
 * `createAdditiveBoneSlot` directly against plain `THREE.Object3D` bones —
 * no React rendering required.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyAdditiveDelta, createAdditiveBoneSlot } from "./additiveBone";

describe("applyAdditiveDelta", () => {
  it("a constant 5-degree Y-axis delta applied 100 times ends 5 degrees from the original orientation, not 500", () => {
    const bone = new THREE.Object3D();
    const original = bone.quaternion.clone();
    const slot = createAdditiveBoneSlot();
    const delta = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      THREE.MathUtils.degToRad(5),
    );

    for (let i = 0; i < 100; i++) {
      applyAdditiveDelta(bone, slot, delta);
    }

    const finalAngle = original.angleTo(bone.quaternion);
    expect(Math.abs(finalAngle - THREE.MathUtils.degToRad(5))).toBeLessThan(1e-4);
    expect(finalAngle).toBeLessThan(THREE.MathUtils.degToRad(500));
  });

  it("when an upstream write sets bone.quaternion to Q_up before each apply, the result equals Q_up * delta", () => {
    const bone = new THREE.Object3D();
    const slot = createAdditiveBoneSlot();
    const delta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.3);

    for (let i = 0; i < 5; i++) {
      const qUp = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        0.1 * (i + 1),
      );
      bone.quaternion.copy(qUp);
      applyAdditiveDelta(bone, slot, delta);

      const expected = qUp.clone().multiply(delta);
      expect(bone.quaternion.angleTo(expected)).toBeLessThan(1e-6);
    }
  });

  it("with no upstream writes, applying delta A then delta B yields base * B, not base * A * B", () => {
    const bone = new THREE.Object3D();
    const base = bone.quaternion.clone();
    const slot = createAdditiveBoneSlot();
    const deltaA = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.2);
    const deltaB = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.4);

    applyAdditiveDelta(bone, slot, deltaA);
    applyAdditiveDelta(bone, slot, deltaB);

    const expected = base.clone().multiply(deltaB);
    expect(bone.quaternion.angleTo(expected)).toBeLessThan(1e-6);
  });

  it("an identity delta leaves the original orientation unchanged", () => {
    const bone = new THREE.Object3D();
    bone.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.5);
    const original = bone.quaternion.clone();
    const slot = createAdditiveBoneSlot();
    const identityDelta = new THREE.Quaternion();

    applyAdditiveDelta(bone, slot, identityDelta);
    applyAdditiveDelta(bone, slot, identityDelta);

    expect(bone.quaternion.angleTo(original)).toBeLessThan(1e-6);
  });
});
