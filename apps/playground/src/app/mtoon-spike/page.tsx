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
 * PreviewModel.tsx: ambientLight 0.7 + one directionalLight at [10,10,5]) so a
 * visible difference is attributable to the change under test.
 *
 * SPIKE 003 extends this same page with a tone-mapping selector, an exposure
 * slider, and an automated sweep that measures saturation/brightness per curve.
 * Spike 002's repair toggle is unchanged and still independently switchable —
 * hold one variable while moving the other.
 */

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import {
  DEFAULT_REPAIR,
  repairMToonMaterials,
  restoreMToon,
  snapshotMToon,
  type MToonSnapshot,
  type RepairResult,
} from "./repairMToon";
import { measureCanvas, type FrameStats } from "./measureSaturation";

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

/**
 * The curves worth comparing for toon output. MToon's fragment shader includes
 * `<tonemapping_fragment>` (verified in @pixiv/three-vrm-materials-mtoon@3.4.2),
 * so the renderer's choice lands on toon surfaces just like PBR ones.
 */
const TONE_MAPPINGS = [
  { label: "None", value: THREE.NoToneMapping },
  { label: "Neutral", value: THREE.NeutralToneMapping },
  { label: "ACESFilmic (today)", value: THREE.ACESFilmicToneMapping },
  { label: "AgX", value: THREE.AgXToneMapping },
  { label: "Reinhard", value: THREE.ReinhardToneMapping },
  { label: "Cineon", value: THREE.CineonToneMapping },
] as const;

/** Applies the renderer-global tone mapping + exposure from inside the Canvas. */
function ToneMappingRig({ mode, exposure }: { mode: THREE.ToneMapping; exposure: number }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.toneMapping = mode;
    gl.toneMappingExposure = exposure;
    gl.outputColorSpace = THREE.SRGBColorSpace;
  }, [gl, mode, exposure]);
  return null;
}

function Panel({
  src,
  label,
  note,
  repair,
  onResult,
  toneMapping,
  exposure,
  canvasHostRef,
}: {
  src: string;
  label: string;
  note: string;
  repair: boolean;
  onResult: (label: string, r: RepairResult | null) => void;
  toneMapping: THREE.ToneMapping;
  exposure: number;
  canvasHostRef?: React.RefObject<HTMLDivElement | null>;
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
      <div ref={canvasHostRef} style={{ flex: 1, background: "#E2E8F2" }}>
        {/* preserveDrawingBuffer is required for the 003 sweep to read pixels
            back after the frame has been presented. */}
        <Canvas
          shadows
          camera={{ fov: 20, position: [0, 0.1, 4] }}
          gl={{ preserveDrawingBuffer: true }}
        >
          <ToneMappingRig mode={toneMapping} exposure={exposure} />
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

type SweepRow = { label: string; stats: FrameStats };

export default function MToonSpikePage() {
  const [repair, setRepair] = useState(false);
  const [results, setResults] = useState<Record<string, RepairResult | null>>({});
  const [tmIndex, setTmIndex] = useState(2); // ACESFilmic — today's default
  const [exposure, setExposure] = useState(1);
  const [sweep, setSweep] = useState<SweepRow[] | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const leftHostRef = useRef<HTMLDivElement | null>(null);

  /**
   * Walk every curve, let two frames render at each, and sample the left
   * canvas. Automated because the whole point is to remove eyeball bias from a
   * comparison where brightness and saturation move together.
   */
  const runSweep = useCallback(async () => {
    setSweeping(true);
    setSweep(null);
    const rows: SweepRow[] = [];
    const original = tmIndex;
    for (let i = 0; i < TONE_MAPPINGS.length; i++) {
      setTmIndex(i);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 120));
      const canvas = leftHostRef.current?.querySelector("canvas");
      const stats = canvas ? measureCanvas(canvas) : null;
      if (stats) rows.push({ label: TONE_MAPPINGS[i].label, stats });
    }
    setTmIndex(original);
    setSweep(rows);
    setSweeping(false);
  }, [tmIndex]);

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
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          Tone mapping
          <select
            value={tmIndex}
            onChange={(e) => setTmIndex(Number(e.target.value))}
            style={{
              background: "#232838",
              color: "#e8ecf4",
              border: "1px solid #3a4358",
              borderRadius: 6,
              padding: "5px 8px",
              fontFamily: "inherit",
              fontSize: 12,
            }}
          >
            {TONE_MAPPINGS.map((t, i) => (
              <option key={t.label} value={i}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          Exposure {exposure.toFixed(2)}
          <input
            type="range"
            min={0.4}
            max={2}
            step={0.05}
            value={exposure}
            onChange={(e) => setExposure(Number(e.target.value))}
          />
        </label>

        <button
          onClick={runSweep}
          disabled={sweeping}
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            border: "1px solid #3a4358",
            background: "#232838",
            color: "#e8ecf4",
            cursor: sweeping ? "wait" : "pointer",
            fontFamily: "inherit",
            fontSize: 12,
          }}
        >
          {sweeping ? "measuring…" : "Sweep + measure"}
        </button>
      </header>

      <div style={{ flex: 1, display: "flex", gap: 1, background: "#232838", minHeight: 0 }}>
        {MODELS.map((m, i) => (
          <Panel
            key={m.src}
            {...m}
            repair={repair}
            onResult={onResult}
            toneMapping={TONE_MAPPINGS[tmIndex].value}
            exposure={exposure}
            canvasHostRef={i === 0 ? leftHostRef : undefined}
          />
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
        {sweep && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>
              Tone-mapping sweep — left canvas ({MODELS[0].label}), repair {repair ? "ON" : "OFF"},
              exposure {exposure.toFixed(2)}
            </div>
            <div style={{ opacity: 0.55 }}>
              {"  "}
              {"curve".padEnd(22)}
              {"meanSat".padStart(9)}
              {"meanVal".padStart(9)}
              {"spread".padStart(9)}
            </div>
            {sweep.map((r) => (
              <div key={r.label} style={{ opacity: 0.85 }}>
                {"  "}
                {r.label.padEnd(22)}
                {r.stats.meanSaturation.toFixed(4).padStart(9)}
                {r.stats.meanValue.toFixed(4).padStart(9)}
                {r.stats.valueSpread.toFixed(4).padStart(9)}
              </div>
            ))}
          </div>
        )}
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
