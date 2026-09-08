"use client";

/**
 * SPIKE 002 — MToon repair pass, side-by-side.
 *
 * Left:  male.vrm                  — badly authored (toony ~0.15 on 14/19 mats,
 *                                    hair permanently fully-lit, rim dead 19/19)
 * Right: 3636451243928341470.vrm   — well authored VRM 1.0 (real rim colours,
 *                                    sane fresnel) — the NON-REGRESSION control.
 *
 * The lighting here deliberately mirrors production (`khavee-app`'s
 * PreviewModel.tsx: ambientLight 0.7 + one directionalLight at [10,10,5]) and
 * the renderer keeps today's ACESFilmicToneMapping, so any visible difference
 * comes from the material pass alone. Tone mapping is spike 003's variable.
 */

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_REPAIR,
  repairMToonMaterials,
  restoreMToon,
  snapshotMToon,
  type MToonSnapshot,
  type RepairResult,
} from "./repairMToon";

const MODELS = [
  { src: "/models/male.vrm", label: "male.vrm", note: "badly authored — expect a visible lift" },
  {
    src: "/models/3636451243928341470.vrm",
    label: "3636451243928341470.vrm",
    note: "well authored VRM 1.0 — NON-REGRESSION control, expect ~no change",
  },
] as const;

function useVrm(src: string) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.loadAsync(src).then((gltf) => {
      const loaded = gltf.userData.vrm as VRM;
      if (cancelled || !loaded) return;
      // VRM 0.x faces +Z; without this the control model shows us its back.
      VRMUtils.rotateVRM0(loaded);
      loaded.scene.traverse((o) => {
        o.frustumCulled = false;
      });
      setVrm(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);
  return vrm;
}

function Model({ vrm }: { vrm: VRM }) {
  useFrame((_, delta) => vrm.update(delta));
  return <primitive object={vrm.scene} position={[0, -1.1, 0]} />;
}

function Panel({
  src,
  label,
  note,
  repair,
  onResult,
}: {
  src: string;
  label: string;
  note: string;
  repair: boolean;
  onResult: (label: string, r: RepairResult | null) => void;
}) {
  const vrm = useVrm(src);
  const snapRef = useRef<MToonSnapshot | null>(null);

  useEffect(() => {
    if (!vrm) return;
    // Snapshot the authored values exactly once, before anything is written,
    // so toggling repair off restores the real original rather than the
    // previous frame's already-repaired state.
    if (!snapRef.current) snapRef.current = snapshotMToon(vrm.scene);

    if (repair) {
      onResult(label, repairMToonMaterials(vrm.scene, DEFAULT_REPAIR));
    } else {
      restoreMToon(vrm.scene, snapRef.current);
      onResult(label, null);
    }
  }, [vrm, repair, label, onResult]);

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "8px 12px", background: "#151821" }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
        <div style={{ fontSize: 11, opacity: 0.6 }}>{note}</div>
      </div>
      <div style={{ flex: 1, background: "#E2E8F2" }}>
        <Canvas shadows camera={{ fov: 20, position: [0, 0.1, 4] }}>
          {/* identical to khavee-app PreviewModel.tsx today */}
          <ambientLight intensity={0.7} />
          <directionalLight position={[10, 10, 5]} castShadow />
          <OrbitControls target={[0, 0.05, 0]} maxPolarAngle={Math.PI / 2} />
          {vrm && <Model vrm={vrm} />}
        </Canvas>
      </div>
    </div>
  );
}

export default function MToonSpikePage() {
  const [repair, setRepair] = useState(false);
  const [results, setResults] = useState<Record<string, RepairResult | null>>({});

  // Stable identity so Panel's effect does not re-run every render.
  const onResult = useMemo(
    () => (label: string, r: RepairResult | null) =>
      setResults((prev) => ({ ...prev, [label]: r })),
    [],
  );

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#0d1016",
        color: "#e8ecf4",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      <header
        style={{
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          borderBottom: "1px solid #232838",
        }}
      >
        <strong style={{ fontSize: 14 }}>Spike 002 — MToon repair pass</strong>
        <button
          onClick={() => setRepair((v) => !v)}
          style={{
            padding: "6px 16px",
            borderRadius: 6,
            border: "1px solid #3a4358",
            background: repair ? "#2f6f4f" : "#232838",
            color: "#e8ecf4",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 13,
          }}
        >
          Repair: {repair ? "ON" : "OFF"}
        </button>
        <span style={{ fontSize: 11, opacity: 0.55 }}>
          lighting + tone mapping held at today&apos;s production values — material pass is the
          only variable
        </span>
      </header>

      <div style={{ flex: 1, display: "flex", gap: 1, background: "#232838", minHeight: 0 }}>
        {MODELS.map((m) => (
          <Panel key={m.src} {...m} repair={repair} onResult={onResult} />
        ))}
      </div>

      <div
        style={{
          height: 190,
          overflow: "auto",
          borderTop: "1px solid #232838",
          padding: "8px 16px",
          fontSize: 11,
        }}
      >
        {!repair && <div style={{ opacity: 0.5 }}>Repair is OFF — showing authored values.</div>}
        {repair &&
          MODELS.map(({ label }) => {
            const r = results[label];
            if (!r) return null;
            const byRule = r.log.reduce<Record<string, number>>((acc, e) => {
              acc[e.rule] = (acc[e.rule] ?? 0) + 1;
              return acc;
            }, {});
            return (
              <div key={label} style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 600 }}>
                  {label} — {r.touched}/{r.mtoonCount} MToon materials touched, {r.skippedFaceDetail}{" "}
                  face-detail skipped
                </div>
                <div style={{ opacity: 0.7 }}>
                  {Object.entries(byRule)
                    .map(([k, v]) => `${k}×${v}`)
                    .join("   ") || "no rules fired"}
                </div>
                {r.log.map((e, i) => (
                  <div key={i} style={{ opacity: 0.55 }}>
                    {"  "}
                    {e.rule.padEnd(13)} {e.material.slice(0, 28).padEnd(30)} {e.before} → {e.after}
                  </div>
                ))}
              </div>
            );
          })}
      </div>
    </div>
  );
}
