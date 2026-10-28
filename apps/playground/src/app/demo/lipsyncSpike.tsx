'use client';

/**
 * Lip-sync engine spike: drives the VRM mouth from the same TTS audio node with
 * wLipSync instead of the SDK's built-in lip sync (HeadAudio since it won this
 * spike), so the two can be compared by eye. Playground-only — not SDK code.
 *
 * Ordering: this component must mount after VRMAvatar (it does — it renders only
 * once useVRM() returns the loaded model), so its useFrame runs after the
 * avatar's frame. It overwrites the five mouth expressions and re-applies the
 * expression manager, so its values are what renders this frame. The SDK's jaw
 * motion is left running in every mode.
 */
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useKhavee, useVRM } from '@khaveeai/react';

export type LipSyncEngine = 'sdk' | 'wlipsync';
export const MOUTH_KEYS = ['aa', 'ih', 'ou', 'ee', 'oh'] as const;
export type MouthKey = (typeof MOUTH_KEYS)[number];
export type Mouth = Record<MouthKey, number>;

export interface LipSyncStats {
  /** Frames (while speaking) in which each shape dominated, or the mouth was closed. */
  counts: Record<MouthKey | 'closed', number>;
  current: Mouth;
}

export function createStats(): LipSyncStats {
  return { counts: { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, closed: 0 }, current: zeroMouth() };
}

function zeroMouth(): Mouth {
  return { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Below this, a frame counts as "closed" in the stats. */
const OPEN_THRESHOLD = 0.15;

interface EngineHandle {
  input: AudioNode;
  read(): Mouth;
  update?(deltaMs: number): void;
}

async function createWLipSync(ctx: AudioContext): Promise<EngineHandle> {
  const { createWLipSyncNode, parseBinaryProfile } = await import('wlipsync');
  const buf = await fetch('/lipsync/wlipsync-profile.bin').then((r) => r.arrayBuffer());
  const node = await createWLipSyncNode(ctx, parseBinaryProfile(buf));
  return {
    input: node,
    read: () => {
      const w = node.weights;
      const v = node.volume;
      return {
        aa: (w.A ?? 0) * v,
        ih: (w.I ?? 0) * v,
        ou: (w.U ?? 0) * v,
        ee: (w.E ?? 0) * v,
        oh: (w.O ?? 0) * v,
      };
    },
  };
}

// One engine node per (engine, AudioContext), kept alive across toggles:
// registering the same worklet processor twice on one context throws.
const engineCache = new Map<string, WeakMap<AudioContext, Promise<EngineHandle>>>();

function getEngine(engine: Exclude<LipSyncEngine, 'sdk'>, ctx: AudioContext): Promise<EngineHandle> {
  let perCtx = engineCache.get(engine);
  if (!perCtx) {
    perCtx = new WeakMap();
    engineCache.set(engine, perCtx);
  }
  let handle = perCtx.get(ctx);
  if (!handle) {
    handle = createWLipSync(ctx);
    perCtx.set(ctx, handle);
    handle.catch(() => perCtx!.delete(ctx));
  }
  return handle;
}

export function LipSyncSpike({
  engine,
  gain,
  stats,
}: {
  engine: LipSyncEngine;
  gain: number;
  stats: React.MutableRefObject<LipSyncStats>;
}) {
  const vrm = useVRM();
  const { realtimeProvider, chatStatus } = useKhavee();
  const handleRef = useRef<EngineHandle | null>(null);

  useEffect(() => {
    handleRef.current = null;
    if (engine === 'sdk' || !realtimeProvider) return;

    let cancelled = false;
    let connected: { analyser: AnalyserNode; input: AudioNode } | null = null;

    // The provider only has an analyser once TTS audio exists, and may replace
    // it on reconnect, so poll and re-patch rather than connect once.
    const tryConnect = async () => {
      const audio = realtimeProvider.getAudioAnalyser?.();
      if (!audio || cancelled || connected?.analyser === audio.analyser) return;
      const handle = await getEngine(engine, audio.audioContext);
      if (cancelled) return;
      if (connected) {
        try {
          connected.analyser.disconnect(connected.input);
        } catch {}
      }
      audio.analyser.connect(handle.input);
      connected = { analyser: audio.analyser, input: handle.input };
      handleRef.current = handle;
    };

    const report = (e: unknown) => console.warn(`[lipsync-spike:${engine}]`, e);
    void tryConnect().catch(report);
    const id = setInterval(() => void tryConnect().catch(report), 300);

    return () => {
      cancelled = true;
      clearInterval(id);
      if (connected) {
        try {
          connected.analyser.disconnect(connected.input);
        } catch {}
      }
      handleRef.current = null;
    };
  }, [engine, realtimeProvider]);

  useFrame((_, delta) => {
    const em = vrm?.expressionManager;
    if (!em) return;

    let mouth: Mouth;
    if (engine === 'sdk') {
      mouth = zeroMouth();
      for (const key of MOUTH_KEYS) mouth[key] = em.getValue(key) ?? 0;
    } else {
      const handle = handleRef.current;
      if (!handle) return;
      handle.update?.(delta * 1000);
      const raw = handle.read();
      mouth = zeroMouth();
      for (const key of MOUTH_KEYS) {
        mouth[key] = clamp01(raw[key] * gain);
        em.setValue(key, mouth[key]);
      }
      em.update();
    }

    const s = stats.current;
    s.current = mouth;
    if (chatStatus !== 'speaking') return;
    let best: MouthKey = 'aa';
    for (const key of MOUTH_KEYS) if (mouth[key] > mouth[best]) best = key;
    s.counts[mouth[best] >= OPEN_THRESHOLD ? best : 'closed']++;
  });

  return null;
}
