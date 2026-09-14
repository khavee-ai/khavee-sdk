"use client";
/**
 * Phase 16 lighting comparison harness — permanent fixture, not a spike.
 *
 * Purpose: MEASURE-01 (same-harness contrast comparison, three-point vs legacy),
 * plus human confirmation of LIGHT-01, POST-01, POST-02, BG-01, OUTLINE-01.
 *
 * Imports `measureCanvas` from `mtoon-spike` read-only. Does NOT modify that
 * page — spike MANIFEST graduated it into a permanent regression fixture.
 */

import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import {
  KhaveeProvider,
  VRMAvatar,
  AvatarPostFX,
  AvatarContactShadows,
  ShadowFloor,
  type LightRigOptions,
  type AvatarBackground,
  type AvatarToneMapping,
  type DepthOfFieldOptions,
} from "@khaveeai/react";
import { measureCanvas, type FrameStats } from "../mtoon-spike/measureSaturation";
import { getFixtures, type FixtureKey } from "./fixtureTextures";

const MODELS = [
  { src: "/models/male.vrm", label: "male.vrm" },
  { src: "/models/3636451243928341470.vrm", label: "3636451243928341470.vrm" },
] as const;

const TONE_MAPPINGS: { label: string; value: AvatarToneMapping }[] = [
  { label: "none", value: "none" },
  { label: "neutral", value: "neutral" },
  { label: "aces-filmic", value: "aces-filmic" },
  { label: "agx", value: "agx" },
  { label: "reinhard", value: "reinhard" },
  { label: "cineon", value: "cineon" },
];

type RigId = "legacy" | "three-point";

interface MeasurementRow {
  id: number;
  rig: RigId;
  model: string;
  ambient: number | null;
  outlines: boolean;
  bloom: boolean;
  smaa: boolean;
  dof: boolean;
  vignette: boolean;
  grading: boolean;
  toneMapping: string;
  stats: FrameStats;
}

/**
 * Reproduces khavee-app's production rig exactly: ambient 0.7 + one directional
 * at [10,10,5] with NO shadow tuning. Must match mtoon-spike/page.tsx and
 * lighting-spike/rigs.tsx:LegacyRig, or the comparison silently invalidates itself.
 */
function LegacyRig() {
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[10, 10, 5]} castShadow />
    </>
  );
}

/** Helper to read draw calls and triangles from inside the Canvas. */
function RenderStatsReadout({ onStats }: { onStats: (calls: number, tris: number) => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const id = setInterval(() => {
      onStats(gl.info.render.calls, gl.info.render.triangles);
    }, 500);
    return () => clearInterval(id);
  }, [gl, onStats]);
  return null;
}

export default function LightingPage() {
  // Rig and ambient
  const [rig, setRig] = useState<RigId>("legacy");
  const [ambientOverride, setAmbientOverride] = useState<number | null>(null);

  // Model
  const [modelIndex, setModelIndex] = useState(0);

  // Background
  const [bgMode, setBgMode] = useState<"none" | "color" | "fixture">("none");
  const [bgColor, setBgColor] = useState("#808080");
  const [fixtureKey, setFixtureKey] = useState<FixtureKey>("landscape_16_9");
  const FIXTURES = useMemo(() => getFixtures(), []);
  const [bgFit, setBgFit] = useState<"cover" | "contain">("cover");

  // Post FX
  const [bloom, setBloom] = useState(false);
  const [smaa, setSmaa] = useState(false);
  const [dof, setDof] = useState(false);
  const [vignette, setVignette] = useState(false);
  const [grading, setGrading] = useState(false);
  const [tmIndex, setTmIndex] = useState(5); // cineon

  // Outlines
  const [outlines, setOutlines] = useState(false);

  // Readouts
  const [visibilityState, setVisibilityState] = useState<DocumentVisibilityState>("visible");
  const [fps, setFps] = useState(0);
  const [frameTime, setFrameTime] = useState(0);
  const [renderCalls, setRenderCalls] = useState(0);
  const [renderTris, setRenderTris] = useState(0);

  // Measurement
  const [rows, setRows] = useState<MeasurementRow[]>([]);
  const [nextRowId, setNextRowId] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      setVisibilityState(document.visibilityState);
    }, 500);
    return () => clearInterval(id);
  }, []);

  // FPS measurement
  const frameCount = useRef(0);
  const frameAccum = useRef(0);
  const lastUpdate = useRef(Date.now());
  useEffect(() => {
    let rafId: number;
    const measure = (time: number) => {
      const now = Date.now();
      const delta = now - lastUpdate.current;
      if (delta >= 1000) {
        const measured = frameCount.current / (delta / 1000);
        setFps(measured);
        setFrameTime(delta / frameCount.current);
        frameCount.current = 0;
        lastUpdate.current = now;
      }
      frameCount.current++;
      rafId = requestAnimationFrame(measure);
    };
    rafId = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const lighting = useMemo<LightRigOptions | undefined>(() => {
    if (rig === "legacy") return undefined;
    if (ambientOverride === null) return undefined;
    return { ambient: ambientOverride };
  }, [rig, ambientOverride]);

  const background = useMemo<AvatarBackground | undefined>(() => {
    if (bgMode === "none") return undefined;
    if (bgMode === "color") return { type: "color", value: bgColor };
    return { type: "image", url: FIXTURES[fixtureKey], fit: bgFit };
  }, [bgMode, bgColor, fixtureKey, bgFit]);

  // For dof, vignette, grading: pass true/false directly (the component handles undefined = default)

  const handleMeasure = useCallback(() => {
    if (!canvasRef.current) return;
    const stats = measureCanvas(canvasRef.current);
    if (!stats) return;

    const row: MeasurementRow = {
      id: nextRowId,
      rig,
      model: MODELS[modelIndex].label,
      ambient: ambientOverride,
      outlines,
      bloom,
      smaa,
      dof,
      vignette,
      grading,
      toneMapping: TONE_MAPPINGS[tmIndex].label,
      stats,
    };
    setRows((prev) => [...prev, row]);
    setNextRowId((id) => id + 1);
  }, [nextRowId, rig, modelIndex, ambientOverride, outlines, bloom, smaa, dof, vignette, grading, tmIndex]);

  const copyRows = useCallback(() => {
    if (rows.length === 0) return;
    const header = "| # | rig | model | ambient | outlines | bloom | smaa | dof | vignette | grading | toneMap | meanSat | meanVal | spread | px |";
    const sep = "|---|-----|-------|---------|----------|-------|------|-----|----------|---------|---------|---------|---------|--------|-----|";
    const lines = rows.map((r) =>
      `| ${r.id} | ${r.rig} | ${r.model.slice(0, 8)} | ${r.ambient ?? "-"} | ${r.outlines ? "Y" : "N"} | ${r.bloom ? "Y" : "N"} | ${r.smaa ? "Y" : "N"} | ${r.dof ? "Y" : "N"} | ${r.vignette ? "Y" : "N"} | ${r.grading ? "Y" : "N"} | ${r.toneMapping.slice(0, 6)} | ${r.stats.meanSaturation.toFixed(4)} | ${r.stats.meanValue.toFixed(4)} | ${r.stats.valueSpread.toFixed(4)} | ${(r.stats.coveredPixels / 1000).toFixed(0)}k |`,
    );
    const md = [header, sep, ...lines].join("\n");
    navigator.clipboard.writeText(md);
  }, [rows]);

  // Reproduction check: find earlier rows with identical config
  const reproCheck = useMemo(() => {
    if (rows.length < 2) return null;
    const last = rows[rows.length - 1];
    const matches = rows.slice(0, -1).filter((r) =>
      r.rig === last.rig &&
      r.model === last.model &&
      r.ambient === last.ambient &&
      r.outlines === last.outlines &&
      r.bloom === last.bloom &&
      r.smaa === last.smaa &&
      r.dof === last.dof &&
      r.vignette === last.vignette &&
      r.grading === last.grading &&
      r.toneMapping === last.toneMapping,
    );
    if (matches.length === 0) return null;
    const prev = matches[matches.length - 1];
    const delta = Math.abs(last.stats.valueSpread - prev.stats.valueSpread);
    return { prev: prev.id, delta, large: delta > 0.01 };
  }, [rows]);

  const box: React.CSSProperties = {
    background: "#1e1e2e",
    color: "#fff",
    border: "1px solid #444",
    borderRadius: 6,
    padding: "8px 12px",
    fontFamily: "monospace",
    fontSize: 12,
  };

  const button: React.CSSProperties = {
    padding: "6px 12px",
    border: "1px solid #444",
    borderRadius: 4,
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: 11,
    background: "#2a2a3e",
    color: "#fff",
  };

  return (
    <KhaveeProvider>
    <div style={{ width: "100%", height: "100vh", display: "flex", flexDirection: "column", background: "#000" }}>
      {/* Canvas */}
      <div style={{ flex: 1, position: "relative" }}>
        <Canvas
          shadows
          camera={{ fov: 20, position: [0, 0.1, 4] }}
          gl={{ preserveDrawingBuffer: true }}
          onCreated={({ gl }) => {
            canvasRef.current = gl.domElement;
          }}
        >
          {rig === "legacy" ? <LegacyRig /> : null}
          <VRMAvatar
            src={MODELS[modelIndex].src}
            position={[0, -1.1, 0]}
            autoLighting={rig !== "legacy"}
            lighting={lighting}
            background={background}
            outlines={outlines}
            onBackgroundError={(err) => console.error("Background error:", err)}
          />
          <ShadowFloor />
          <AvatarContactShadows />
          <AvatarPostFX
            bloom={bloom}
            smaa={smaa}
            dof={dof}
            vignette={vignette}
            grading={grading}
            toneMapping={TONE_MAPPINGS[tmIndex].value}
          />
          <OrbitControls target={[0, 0.05, 0]} maxPolarAngle={Math.PI / 2} />
          <RenderStatsReadout onStats={(calls, tris) => { setRenderCalls(calls); setRenderTris(tris); }} />
        </Canvas>
      </div>

      {/* Control panel */}
      <div style={{ height: 280, overflowY: "auto", borderTop: "1px solid #444", padding: 12, background: "#0d1016", display: "flex", gap: 12, flexWrap: "wrap" }}>
        {/* Rig */}
        <div style={box}>
          <div style={{ fontWeight: "bold", marginBottom: 6 }}>Rig</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <button
              onClick={() => setRig("legacy")}
              style={{
                ...button,
                background: rig === "legacy" ? "#6366f1" : "#2a2a3e",
              }}
            >
              legacy
            </button>
            <button
              onClick={() => setRig("three-point")}
              style={{
                ...button,
                background: rig === "three-point" ? "#6366f1" : "#2a2a3e",
              }}
            >
              three-point
            </button>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
            Ambient override
            <input
              type="number"
              min={0}
              max={2}
              step={0.05}
              value={ambientOverride ?? ""}
              onChange={(e) => setAmbientOverride(e.target.value === "" ? null : Number(e.target.value))}
              style={{ width: 60, background: "#232838", color: "#fff", border: "1px solid #444", borderRadius: 3, padding: "3px 6px" }}
            />
          </label>
        </div>

        {/* Model */}
        <div style={box}>
          <div style={{ fontWeight: "bold", marginBottom: 6 }}>Model</div>
          {MODELS.map((m, i) => (
            <button
              key={m.src}
              onClick={() => setModelIndex(i)}
              style={{
                ...button,
                background: modelIndex === i ? "#6366f1" : "#2a2a3e",
                display: "block",
                width: "100%",
                marginBottom: 4,
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Background */}
        <div style={box}>
          <div style={{ fontWeight: "bold", marginBottom: 6 }}>Background</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            <button
              onClick={() => setBgMode("none")}
              style={{
                ...button,
                background: bgMode === "none" ? "#6366f1" : "#2a2a3e",
              }}
            >
              none
            </button>
            <button
              onClick={() => setBgMode("color")}
              style={{
                ...button,
                background: bgMode === "color" ? "#6366f1" : "#2a2a3e",
              }}
            >
              color
            </button>
            <button
              onClick={() => setBgMode("fixture")}
              style={{
                ...button,
                background: bgMode === "fixture" ? "#6366f1" : "#2a2a3e",
              }}
            >
              fixture
            </button>
          </div>
          {bgMode === "color" && (
            <input
              type="color"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              style={{ width: "100%" }}
            />
          )}
          {bgMode === "fixture" && (
            <>
              <select
                value={fixtureKey}
                onChange={(e) => setFixtureKey(e.target.value as FixtureKey)}
                style={{ width: "100%", marginBottom: 6, background: "#232838", color: "#fff", border: "1px solid #444", borderRadius: 3, padding: "4px 6px" }}
              >
                <option value="landscape_16_9">16:9 landscape</option>
                <option value="square_1_1">1:1 square</option>
                <option value="portrait_9_16">9:16 portrait</option>
                <option value="sky_ground">sky/ground</option>
              </select>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => setBgFit("cover")}
                  style={{
                    ...button,
                    background: bgFit === "cover" ? "#6366f1" : "#2a2a3e",
                    flex: 1,
                  }}
                >
                  cover
                </button>
                <button
                  onClick={() => setBgFit("contain")}
                  style={{
                    ...button,
                    background: bgFit === "contain" ? "#6366f1" : "#2a2a3e",
                    flex: 1,
                  }}
                >
                  contain
                </button>
              </div>
            </>
          )}
        </div>

        {/* Post FX */}
        <div style={box}>
          <div style={{ fontWeight: "bold", marginBottom: 6 }}>Post FX</div>
          <label style={{ display: "block", marginBottom: 4 }}>
            <input type="checkbox" checked={bloom} onChange={(e) => setBloom(e.target.checked)} /> bloom
          </label>
          <label style={{ display: "block", marginBottom: 4 }}>
            <input type="checkbox" checked={smaa} onChange={(e) => setSmaa(e.target.checked)} /> smaa
          </label>
          <label style={{ display: "block", marginBottom: 4 }}>
            <input type="checkbox" checked={dof} onChange={(e) => setDof(e.target.checked)} /> dof
          </label>
          <label style={{ display: "block", marginBottom: 4 }}>
            <input type="checkbox" checked={vignette} onChange={(e) => setVignette(e.target.checked)} /> vignette
          </label>
          <label style={{ display: "block", marginBottom: 4 }}>
            <input type="checkbox" checked={grading} onChange={(e) => setGrading(e.target.checked)} /> grading
          </label>
          <select
            value={tmIndex}
            onChange={(e) => setTmIndex(Number(e.target.value))}
            style={{ width: "100%", background: "#232838", color: "#fff", border: "1px solid #444", borderRadius: 3, padding: "4px 6px" }}
          >
            {TONE_MAPPINGS.map((t, i) => (
              <option key={t.label} value={i}>
                tone: {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Outlines */}
        <div style={box}>
          <div style={{ fontWeight: "bold", marginBottom: 6 }}>Outlines</div>
          <label>
            <input type="checkbox" checked={outlines} onChange={(e) => setOutlines(e.target.checked)} /> enable
          </label>
        </div>

        {/* Readouts */}
        <div style={box}>
          <div style={{ fontWeight: "bold", marginBottom: 6 }}>Readouts</div>
          <div>visibilityState: <span style={{ color: visibilityState === "visible" ? "#00e5a0" : "#ff6e9c" }}>{visibilityState}</span></div>
          {visibilityState !== "visible" && (
            <div style={{ color: "#ff6e9c", fontSize: 11, marginTop: 4 }}>
              ⚠ Tab is not visible — frame timings and pixel reads are throttled. Do NOT record measurements.
            </div>
          )}
          <div>FPS: {fps.toFixed(1)} ({frameTime.toFixed(1)} ms/frame)</div>
          <div>render.calls: {renderCalls}</div>
          <div>render.triangles: {renderTris}</div>
        </div>

        {/* Measurement */}
        <div style={{ ...box, minWidth: 280 }}>
          <div style={{ fontWeight: "bold", marginBottom: 6 }}>Measurement</div>
          <button
            onClick={handleMeasure}
            disabled={background !== undefined}
            style={{
              ...button,
              width: "100%",
              marginBottom: 6,
              cursor: background !== undefined ? "not-allowed" : "pointer",
              background: background !== undefined ? "#444" : "#2a2a3e",
            }}
          >
            Measure
          </button>
          {background !== undefined && (
            <div style={{ color: "#ff6e9c", fontSize: 11, marginBottom: 6 }}>
              Disabled: background is active. measureCanvas skips alpha &lt; 128, so a backdrop makes it measure the wallpaper instead of the avatar.
            </div>
          )}
          <button
            onClick={copyRows}
            disabled={rows.length === 0}
            style={{
              ...button,
              width: "100%",
              marginBottom: 6,
              cursor: rows.length === 0 ? "not-allowed" : "pointer",
              background: rows.length === 0 ? "#444" : "#2a2a3e",
            }}
          >
            Copy rows ({rows.length})
          </button>
          {reproCheck && (
            <div style={{ fontSize: 11, marginBottom: 6 }}>
              Reproduction check (vs row {reproCheck.prev}): Δspread = {reproCheck.delta.toFixed(5)}
              {reproCheck.large && <span style={{ color: "#ff6e9c" }}> — LARGE DELTA, measurement untrustworthy</span>}
              {!reproCheck.large && <span style={{ color: "#00e5a0" }}> — small delta, trust OK</span>}
            </div>
          )}
          <div style={{ maxHeight: 120, overflowY: "auto", fontSize: 10 }}>
            {rows.map((r) => (
              <div key={r.id} style={{ marginBottom: 2 }}>
                #{r.id} {r.rig} {r.model.slice(0, 6)} spread={r.stats.valueSpread.toFixed(4)} sat={r.stats.meanSaturation.toFixed(4)} val={r.stats.meanValue.toFixed(4)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
    </KhaveeProvider>
  );
}
