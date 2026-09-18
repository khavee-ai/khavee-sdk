"use client";

import { Canvas } from "@react-three/fiber";
import { useState } from "react";
import {
  KhaveeProvider,
  VRMAvatar,
  AvatarCamera,
  AvatarContactShadows,
  type CameraPreset,
  type OrbitMode,
} from "@khaveeai/react";

/**
 * Phase 17 Plan 02 — Camera-demo verification harness
 *
 * Interactive page for visual verification of AvatarCamera features:
 * - Three framing presets (bust-shot, medium-close-up, full-body)
 * - Three orbit modes (locked, constrained, free)
 * - Handheld drift toggle
 * - chatStatus-driven reframe toggle
 * - Verifies no regression in Phase 16 systems (lighting, DOF, shadows, backdrop)
 */

interface CameraDemoSceneProps {
  preset: CameraPreset;
  orbit: OrbitMode;
  drift: boolean;
  reframe: boolean;
}

function CameraDemoScene({ preset, orbit, drift, reframe }: CameraDemoSceneProps) {
  return (
    <>
      <AvatarCamera preset={preset} orbit={orbit} drift={drift} reframe={reframe} />
      <VRMAvatar src="/models/male.vrm" materialPreset="repair" />
      <AvatarContactShadows />
      <ambientLight intensity={0.7} />
      <directionalLight position={[10, 10, 5]} castShadow />
    </>
  );
}

export default function CameraDemoPage() {
  const [preset, setPreset] = useState<CameraPreset>("bust-shot");
  const [orbit, setOrbit] = useState<OrbitMode>("locked");
  const [drift, setDrift] = useState(true);
  const [reframe, setReframe] = useState(true);

  return (
    <KhaveeProvider config={{}}>
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold mb-2">Camera Demo — Verification Harness</h1>
          <p className="text-sm text-gray-600 mb-6">
            Phase 17 Plan 02 — Interactive controls for all AvatarCamera features
          </p>

          {/* Control Panel */}
          <div className="bg-white rounded-lg shadow p-6 mb-6 space-y-4">
            {/* Preset Selector */}
            <div>
              <label className="block text-sm font-semibold mb-2">Camera Preset</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setPreset("bust-shot")}
                  className={`px-4 py-2 rounded-lg border-2 transition-colors ${
                    preset === "bust-shot"
                      ? "border-blue-600 bg-blue-50 text-blue-700 font-semibold"
                      : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                  }`}
                >
                  Bust Shot
                </button>
                <button
                  onClick={() => setPreset("medium-close-up")}
                  className={`px-4 py-2 rounded-lg border-2 transition-colors ${
                    preset === "medium-close-up"
                      ? "border-blue-600 bg-blue-50 text-blue-700 font-semibold"
                      : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                  }`}
                >
                  Medium Close-Up
                </button>
                <button
                  onClick={() => setPreset("full-body")}
                  className={`px-4 py-2 rounded-lg border-2 transition-colors ${
                    preset === "full-body"
                      ? "border-blue-600 bg-blue-50 text-blue-700 font-semibold"
                      : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                  }`}
                >
                  Full Body
                </button>
              </div>
            </div>

            {/* Orbit Mode Selector */}
            <div>
              <label className="block text-sm font-semibold mb-2">Orbit Mode</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setOrbit("locked")}
                  className={`px-4 py-2 rounded-lg border-2 transition-colors ${
                    orbit === "locked"
                      ? "border-green-600 bg-green-50 text-green-700 font-semibold"
                      : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                  }`}
                >
                  Locked
                </button>
                <button
                  onClick={() => setOrbit("constrained")}
                  className={`px-4 py-2 rounded-lg border-2 transition-colors ${
                    orbit === "constrained"
                      ? "border-green-600 bg-green-50 text-green-700 font-semibold"
                      : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                  }`}
                >
                  Constrained
                </button>
                <button
                  onClick={() => setOrbit("free")}
                  className={`px-4 py-2 rounded-lg border-2 transition-colors ${
                    orbit === "free"
                      ? "border-green-600 bg-green-50 text-green-700 font-semibold"
                      : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                  }`}
                >
                  Free
                </button>
              </div>
            </div>

            {/* Toggle Controls */}
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={drift}
                  onChange={(e) => setDrift(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm font-medium">Enable Drift (handheld camera life)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={reframe}
                  onChange={(e) => setReframe(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm font-medium">Enable Reframe (dolly on speaking)</span>
              </label>
            </div>

            {/* Status Display */}
            <div className="pt-4 border-t border-gray-200">
              <div className="text-xs text-gray-600 space-y-1">
                <div>
                  <span className="font-semibold">Current Preset:</span> {preset}
                </div>
                <div>
                  <span className="font-semibold">Orbit Mode:</span> {orbit}
                </div>
                <div>
                  <span className="font-semibold">Drift:</span> {drift ? "enabled" : "disabled"}
                </div>
                <div>
                  <span className="font-semibold">Reframe:</span>{" "}
                  {reframe ? "enabled" : "disabled"}
                </div>
              </div>
            </div>
          </div>

          {/* Canvas Container */}
          <div className="bg-white rounded-lg shadow overflow-hidden" style={{ height: "600px" }}>
            <Canvas shadows>
              <CameraDemoScene preset={preset} orbit={orbit} drift={drift} reframe={reframe} />
            </Canvas>
          </div>

          {/* Verification Notes */}
          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-blue-900 mb-2">Verification Checklist</h2>
            <ul className="text-xs text-blue-800 space-y-1 list-disc list-inside">
              <li>Switch presets — verify smooth eased transitions (not instant cuts)</li>
              <li>
                Verify preset framing — bust-shot (shoulders up), MCU (upper torso), full-body
                (head-to-feet)
              </li>
              <li>
                Toggle drift — ON should show subtle organic camera motion, OFF should be perfectly
                static
              </li>
              <li>Test orbit modes — locked (no interaction), constrained (safe range), free</li>
              <li>
                Verify no regression in lighting, shadows, DOF (should track camera smoothly), or
                backdrop
              </li>
            </ul>
          </div>
        </div>
      </div>
    </KhaveeProvider>
  );
}
