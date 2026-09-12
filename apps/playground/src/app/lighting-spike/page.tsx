"use client";
/**
 * lighting-spike — SPIKE 004 (backdrop-plane-dof). THROWAWAY.
 *
 * Shared page for the Phase 16 spikes (004-007). Deliberately NOT built on
 * `mtoon-spike`: spike conventions say a later spike shares the earlier page
 * so the earlier variable stays constant, but Phase 15 graduated `mtoon-spike`
 * into a permanent regression fixture, so it is no longer a spike surface to
 * borrow. Same intent, new base.
 *
 * 004 asks two things:
 *   1. Can an in-canvas backdrop plane reproduce CSS `background-size: cover`
 *      across viewport resizes? (arithmetic verified headlessly in
 *      `verify-cover-math.mjs`; this page checks it against a real camera)
 *   2. Does depth of field separate the avatar from that backdrop — blurring
 *      the background WITHOUT blurring the subject?
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { EffectComposer, DepthOfField } from "@react-three/postprocessing";
import * as THREE from "three";
import { KhaveeProvider, VRMAvatar } from "@khaveeai/react";
import { coverTransform, planeSizeForDistance, visibleFraction } from "./coverMath";
import { makeTestPatternTexture, TEST_ASPECTS } from "./testTexture";

const AVATAR_Y = -1.1;

interface Readout {
  cameraAspect: number;
  planeW: number;
  planeH: number;
  planeAspect: number;
  imageAspect: number;
  repeat: [number, number];
  offset: [number, number];
  visiblePct: number;
}

/**
 * The backdrop under test. Sizes itself to exactly fill the camera frustum at
 * `distance`, and re-does that on every resize — the part CSS gets for free
 * and a 3D plane does not.
 */
function Backdrop({
  distance,
  imageAspect,
  texture,
  onReadout,
}: {
  distance: number;
  imageAspect: number;
  texture: THREE.Texture;
  onReadout: (r: Readout) => void;
}) {
  const { camera, size } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const cameraAspect = size.width / size.height;
    const { width, height } = planeSizeForDistance(cam.fov, cameraAspect, distance);
    const planeAspect = width / height;
    const { repeat, offset } = coverTransform(planeAspect, imageAspect);

    texture.repeat.set(repeat[0], repeat[1]);
    texture.offset.set(offset[0], offset[1]);
    texture.needsUpdate = true;

    if (meshRef.current) {
      meshRef.current.scale.set(width, height, 1);
      // Sit the plane `distance` in FRONT of the camera along its view axis,
      // not at a fixed world Z — otherwise orbiting the camera slides the
      // backdrop out of frame.
      meshRef.current.position.set(0, AVATAR_Y + height / 2, -distance);
    }

    onReadout({
      cameraAspect,
      planeW: width,
      planeH: height,
      planeAspect,
      imageAspect,
      repeat,
      offset,
      visiblePct: visibleFraction(planeAspect, imageAspect) * 100,
    });
  }, [camera, size.width, size.height, distance, imageAspect, texture, onReadout]);

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[1, 1]} />
      {/* basic, not standard: the backdrop is an image, it must not be
          re-lit by the avatar's rig or it stops matching the source. */}
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

/**
 * Reports the LIVE camera->subject distance every frame.
 *
 * The reason this exists: `worldFocusDistance` is a constant, but the camera
 * is not. Any dolly (OrbitControls' scroll) changes how far the subject
 * actually is, so a fixed focus distance silently stops matching the subject
 * and the subject blurs along with the background. Feeding the measured
 * distance back in is the fix; showing both numbers is how we prove it.
 */
function SubjectTracker({
  subject,
  enabled,
  onDistance,
}: {
  subject: [number, number, number];
  enabled: boolean;
  onDistance: (d: number) => void;
}) {
  const { camera } = useThree();
  const last = useRef(0);
  const vec = useRef(new THREE.Vector3());
  useFrame(() => {
    vec.current.set(subject[0], subject[1], subject[2]);
    const d = camera.position.distanceTo(vec.current);
    // Only push upstream on a meaningful change — a state write every frame
    // would cost more than the effect it is measuring.
    if (Math.abs(d - last.current) > 0.02) {
      last.current = d;
      onDistance(d);
    }
  });
  return enabled ? null : null;
}

/**
 * Walks the live scene and reports what the depth buffer will actually
 * contain. DOF is driven entirely by the depth buffer, and a material with
 * `transparent: true` does NOT write depth by default — so a transparent
 * avatar surface is invisible to DOF, which then treats whatever is behind it
 * as the nearest geometry at that pixel. This probe exists to confirm or kill
 * that explanation rather than guess at it.
 */
function MaterialProbe({ onProbe }: { onProbe: (p: MaterialStats) => void }) {
  const { scene } = useThree();
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    let total = 0;
    let transparent = 0;
    let depthWriteOff = 0;
    let mtoon = 0;
    const offenders: string[] = [];
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m) continue;
        total++;
        if (m.type?.includes("MToon")) mtoon++;
        if (m.transparent) transparent++;
        if (m.depthWrite === false) {
          depthWriteOff++;
          if (offenders.length < 8) offenders.push(m.name || m.type);
        }
      }
    });
    if (total > 0) {
      done.current = true;
      onProbe({ total, transparent, depthWriteOff, mtoon, offenders });
    }
  });
  return null;
}

interface MaterialStats {
  total: number;
  transparent: number;
  depthWriteOff: number;
  mtoon: number;
  offenders: string[];
}

/** Samples real frame times so DOF's cost is observed, not assumed. */
function FrameProbe({ onFps }: { onFps: (fps: number, ms: number) => void }) {
  const acc = useRef({ frames: 0, elapsed: 0 });
  useFrame((_, delta) => {
    const a = acc.current;
    a.frames += 1;
    a.elapsed += delta;
    if (a.elapsed >= 0.5) {
      onFps(a.frames / a.elapsed, (a.elapsed / a.frames) * 1000);
      a.frames = 0;
      a.elapsed = 0;
    }
  });
  return null;
}

export default function LightingSpikePage() {
  const [aspectIndex, setAspectIndex] = useState(0);
  const [distance, setDistance] = useState(6);
  const [dof, setDof] = useState(true);
  const [bokeh, setBokeh] = useState(6);
  const [focusDist, setFocusDist] = useState(3);
  const [trackSubject, setTrackSubject] = useState(true);
  const [subjectDist, setSubjectDist] = useState(3);
  const [focusRange, setFocusRange] = useState(0.6);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [probe, setProbe] = useState<MaterialStats | null>(null);
  const [showAvatar, setShowAvatar] = useState(true);
  const [showRefSphere, setShowRefSphere] = useState(false);
  const [perf, setPerf] = useState({ fps: 0, ms: 0 });
  const [log, setLog] = useState<string[]>([]);

  const { label, aspect } = TEST_ASPECTS[aspectIndex];
  const texture = useMemo(
    () => makeTestPatternTexture({ aspect, label }),
    [aspect, label],
  );
  useEffect(() => () => texture.dispose(), [texture]);

  // Forensic log — records every config change with its resulting numbers, so
  // a finding can be traced back to the exact state that produced it.
  useEffect(() => {
    if (!readout) return;
    setLog((prev) => [
      ...prev.slice(-200),
      JSON.stringify({
        t: new Date().toISOString(),
        aspect: label,
        dof,
        bokeh,
        focusDist,
        focusRange,
        distance,
        cameraAspect: +readout.cameraAspect.toFixed(4),
        planeAspect: +readout.planeAspect.toFixed(4),
        repeat: readout.repeat.map((v) => +v.toFixed(4)),
        visiblePct: +readout.visiblePct.toFixed(1),
        fps: +perf.fps.toFixed(1),
      }),
    ]);
    // Intentionally not depending on perf — otherwise every FPS tick logs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readout, dof, bokeh, focusDist, focusRange, distance, label]);

  const exportLog = () => {
    // eslint-disable-next-line no-console
    console.log("[spike-004] log\n" + log.join("\n"));
  };

  const box: React.CSSProperties = {
    background: "#1e1e2e",
    color: "#fff",
    border: "1px solid #444",
    borderRadius: 6,
    padding: "6px 10px",
    fontFamily: "monospace",
    fontSize: 12,
  };

  return (
    <KhaveeProvider>
      <div style={{ width: "100%", height: "100vh", position: "relative", background: "#000" }}>
        <Canvas camera={{ position: [0, 0.2, 3], fov: 50 }} shadows>
          <Backdrop
            distance={distance}
            imageAspect={aspect}
            texture={texture}
            onReadout={setReadout}
          />
          {showAvatar && <VRMAvatar src="/models/male.vrm" position={[0, AVATAR_Y, 0]} />}
          {/* Opaque control geometry at the avatar's own distance. If THIS
              stays sharp while the backdrop blurs, the DOF configuration is
              correct and the avatar's materials are the variable. */}
          {showRefSphere && (
            <mesh position={[0.55, 0.1, 0]}>
              <sphereGeometry args={[0.22, 32, 32]} />
              <meshStandardMaterial color="#ffd166" roughness={0.4} />
            </mesh>
          )}
          <SubjectTracker subject={[0, 0.25, 0]} enabled onDistance={setSubjectDist} />
          <MaterialProbe onProbe={setProbe} />
          <FrameProbe onFps={(fps, ms) => setPerf({ fps, ms })} />
          <OrbitControls target={[0, 0, 0]} />
          {dof && (
            <EffectComposer>
              <DepthOfField
                worldFocusDistance={trackSubject ? subjectDist : focusDist}
                worldFocusRange={focusRange}
                bokehScale={bokeh}
              />
            </EffectComposer>
          )}
        </Canvas>

        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            zIndex: 10,
            maxWidth: 330,
          }}
        >
          <div style={{ ...box, fontWeight: "bold" }}>SPIKE 004 — backdrop + DOF</div>

          <div style={{ ...box, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {TEST_ASPECTS.map((a, i) => (
              <button
                key={a.label}
                onClick={() => setAspectIndex(i)}
                style={{
                  padding: "4px 8px",
                  background: i === aspectIndex ? "#6366f1" : "#2a2a3e",
                  color: "#fff",
                  border: "1px solid #444",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontFamily: "monospace",
                  fontSize: 11,
                }}
              >
                {a.label}
              </button>
            ))}
          </div>

          <label style={box}>
            <input type="checkbox" checked={dof} onChange={(e) => setDof(e.target.checked)} />{" "}
            depth of field
          </label>

          <div style={{ ...box, display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ opacity: 0.7 }}>isolate the variable</div>
            <label>
              <input type="checkbox" checked={showAvatar}
                onChange={(e) => setShowAvatar(e.target.checked)} /> avatar
            </label>
            <label>
              <input type="checkbox" checked={showRefSphere}
                onChange={(e) => setShowRefSphere(e.target.checked)} /> opaque reference sphere
            </label>
            <label style={{ marginTop: 4 }}>
              <input type="checkbox" checked={trackSubject}
                onChange={(e) => setTrackSubject(e.target.checked)} /> focus tracks subject
            </label>
            <div style={{ fontSize: 10, opacity: 0.75 }}>
              camera-&gt;subject {subjectDist.toFixed(2)} | focusing at{" "}
              {(trackSubject ? subjectDist : focusDist).toFixed(2)}
              {!trackSubject && Math.abs(subjectDist - focusDist) > focusRange && (
                <span style={{ color: "#ff6e9c" }}> ← subject OUT of focus</span>
              )}
            </div>
          </div>

          {probe && (
            <div style={box}>
              <div style={{ opacity: 0.7 }}>depth-buffer probe</div>
              <div>materials {probe.total} (MToon {probe.mtoon})</div>
              <div style={{ color: probe.transparent > 0 ? "#ff6e9c" : "#00e5a0" }}>
                transparent {probe.transparent}
              </div>
              <div style={{ color: probe.depthWriteOff > 0 ? "#ff6e9c" : "#00e5a0" }}>
                depthWrite off {probe.depthWriteOff}
              </div>
              {probe.offenders.length > 0 && (
                <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2 }}>
                  {probe.offenders.join(", ")}
                </div>
              )}
            </div>
          )}

          <div style={box}>
            backdrop distance {distance.toFixed(1)}
            <input type="range" min={2} max={20} step={0.5} value={distance}
              onChange={(e) => setDistance(+e.target.value)} style={{ width: "100%" }} />
            bokeh {bokeh.toFixed(1)}
            <input type="range" min={0} max={20} step={0.5} value={bokeh}
              onChange={(e) => setBokeh(+e.target.value)} style={{ width: "100%" }} />
            focus distance {focusDist.toFixed(2)}
            <input type="range" min={0.5} max={12} step={0.05} value={focusDist}
              onChange={(e) => setFocusDist(+e.target.value)} style={{ width: "100%" }} />
            focus range {focusRange.toFixed(2)}
            <input type="range" min={0.05} max={5} step={0.05} value={focusRange}
              onChange={(e) => setFocusRange(+e.target.value)} style={{ width: "100%" }} />
          </div>

          {readout && (
            <div style={box}>
              <div>viewport aspect {readout.cameraAspect.toFixed(3)}</div>
              <div>plane {readout.planeW.toFixed(2)} x {readout.planeH.toFixed(2)} ({readout.planeAspect.toFixed(3)})</div>
              <div>image aspect {readout.imageAspect.toFixed(3)}</div>
              <div>repeat [{readout.repeat[0].toFixed(3)}, {readout.repeat[1].toFixed(3)}]</div>
              <div>offset [{readout.offset[0].toFixed(3)}, {readout.offset[1].toFixed(3)}]</div>
              <div style={{ color: readout.visiblePct < 60 ? "#ff6e9c" : "#00e5a0" }}>
                image visible {readout.visiblePct.toFixed(1)}%
              </div>
              <div style={{ marginTop: 4, color: perf.fps < 45 ? "#ff6e9c" : "#00e5a0" }}>
                {perf.fps.toFixed(0)} fps / {perf.ms.toFixed(1)} ms
              </div>
            </div>
          )}

          <button onClick={exportLog} style={{ ...box, cursor: "pointer" }}>
            export log to console ({log.length})
          </button>

          <div style={{ ...box, fontSize: 11, lineHeight: 1.5 }}>
            Resize the window and watch the red border: cover is correct if the
            border stays flush to two edges and is cropped on the other two,
            the green crosshair stays centred, and the image never stretches.
          </div>
        </div>
      </div>
    </KhaveeProvider>
  );
}
