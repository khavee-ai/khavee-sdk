'use client';

/**
 * entrance-demo — proof of concept for the SDK's one-shot `entrance` clip.
 * Pick a clip, upload any .vrm, and replay: the clip plays once, lands where
 * idle stands (it is retargeted against its last frame), then hands over to
 * idle.
 */
import { Suspense, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { KhaveeProvider, ShadowFloor, VRMAvatar, type AnimationConfig } from '@khaveeai/react';

const DEFAULT_MODEL = '/models/final-tip.vrm';
const IDLE = '/models/animations/Idle.fbx';

const WALK = '/models/animations/entrance/happy-walk.fbx';

type Entrance =
  | { label: string; kind: 'clip'; url: string }
  | { label: string; kind: 'walk'; from: 'left' | 'right' }
  | { label: string; kind: 'none' };

const ENTRANCES = {
  walkRight: { label: 'Walk in from right', kind: 'walk', from: 'right' },
  walkLeft: { label: 'Walk in from left', kind: 'walk', from: 'left' },
  drop: { label: 'Falling to landing', kind: 'clip', url: '/models/animations/entrance/falling-to-landing.fbx' },
  jump: { label: 'Joyful jump', kind: 'clip', url: '/models/animations/entrance/joyful-jump.fbx' },
  none: { label: 'None (idle only)', kind: 'none' },
} satisfies Record<string, Entrance>;

type EntranceKey = keyof typeof ENTRANCES;

export default function EntranceDemo() {
  const [model, setModel] = useState({ url: DEFAULT_MODEL, name: 'final-tip.vrm' });
  const [entrance, setEntrance] = useState<EntranceKey>('walkRight');
  // null: the SDK matches the walk clip's own stride.
  const [speed, setSpeed] = useState<number | null>(null);
  const [replay, setReplay] = useState(0);

  // Free the previous upload's blob URL when it is replaced or on unmount.
  useEffect(() => {
    const { url } = model;
    return () => {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    };
  }, [model]);

  const chosen: Entrance = ENTRANCES[entrance];
  const animations: AnimationConfig =
    chosen.kind === 'clip'
      ? { entrance: chosen.url, idle: IDLE }
      : chosen.kind === 'walk'
        ? { entranceWalk: WALK, idle: IDLE }
        : { idle: IDLE };
  const entranceWalk = chosen.kind === 'walk' ? { from: chosen.from, speed: speed ?? undefined } : undefined;

  return (
    <div className="relative h-screen w-screen bg-gradient-to-b from-[#dfe7f5] to-[#f6f1ea]">
      <KhaveeProvider>
        <Canvas shadows camera={{ position: [0, 1.1, 4.2], fov: 32 }}>
          <OrbitControls target={[0, 0.9, 0]} enablePan={false} />
          <Suspense fallback={null}>
            {/* Remounting replays the entrance: it only plays on first appearance. */}
            <VRMAvatar
              key={`${model.url}|${entrance}|${speed}|${replay}`}
              src={model.url}
              animations={animations}
              entranceWalk={entranceWalk}
            />
          </Suspense>
          <ShadowFloor y={0} opacity={0.3} />
        </Canvas>
      </KhaveeProvider>

      <div className="absolute left-4 top-4 flex w-72 flex-col gap-3 rounded-2xl bg-white/90 p-4 text-sm text-gray-800 shadow-lg backdrop-blur">
        <div className="font-semibold">Entrance animation POC</div>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">Model</span>
          <span className="truncate text-xs">{model.name}</span>
          <input
            type="file"
            accept=".vrm"
            className="text-xs file:mr-2 file:rounded-full file:border-0 file:bg-blue-600 file:px-3 file:py-1 file:text-white"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) setModel({ url: URL.createObjectURL(file), name: file.name });
              event.target.value = '';
            }}
          />
        </label>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-xs text-gray-500">Entrance clip</legend>
          {(Object.keys(ENTRANCES) as EntranceKey[]).map((key) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="radio"
                name="entrance"
                checked={entrance === key}
                onChange={() => setEntrance(key)}
              />
              {ENTRANCES[key].label}
            </label>
          ))}
        </fieldset>

        {chosen.kind === 'walk' && (
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={speed === null} onChange={(e) => setSpeed(e.target.checked ? null : 1.2)} />
              Speed from the clip&apos;s stride (feet match)
            </label>
            {speed !== null && (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-500">Walk speed {speed.toFixed(1)} m/s</span>
                <input
                  type="range"
                  min={0.6}
                  max={3.5}
                  step={0.1}
                  value={speed}
                  onChange={(event) => setSpeed(Number(event.target.value))}
                />
              </label>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setReplay((n) => n + 1)}
          className="rounded-full bg-blue-600 px-4 py-2 font-medium text-white"
        >
          Replay entrance
        </button>
        <p className="text-xs text-gray-500">
          Clips play once and land where idle stands. Walk-ins slide on from off-frame with an in-place walk loop,
          then turn to the camera as idle crossfades in.
        </p>
      </div>
    </div>
  );
}
