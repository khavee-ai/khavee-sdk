/**
 * headAudio.ts — mouth-shape source backed by HeadAudio (MFCC + trained
 * Gaussian prototypes in an AudioWorklet).
 *
 * HeadAudio only decides WHICH mouth shape the speech is making. How far the
 * mouth opens comes from the viseme step's loudness envelope: HeadAudio's own
 * gate is an absolute dB threshold that fluent TTS never crosses between words,
 * so on its own the mouth stays open across word gaps.
 *
 * The worklet and model are inlined (see vendor/) and loaded through blob URLs,
 * so consumers need no static-asset setup. Requires AudioWorklet in a secure
 * context (https or localhost); callers fall back to the classic classifier
 * when `createHeadAudioShapeSource` rejects.
 */
import type { MouthState } from "@khaveeai/core";
import { HEADWORKLET_SOURCE } from "./vendor/headworklet-source";
import { HEADAUDIO_MODEL_BASE64 } from "./vendor/model-en-mixed";

export interface ShapeFrame {
  /** Mouth shape normalized so its largest key is 1 (all zero when silent). */
  shape: MouthState;
  /** 0..1 lip closure from bilabials (p/b/m) — openness is scaled by `1 - closure`. */
  closure: number;
}

export interface ShapeSource {
  /** Connect the speech audio to this node. It produces no output. */
  input: AudioNode;
  /** Advance blending by one animation frame and read the current shape. */
  update(deltaMs: number): ShapeFrame;
  dispose(): void;
}

const MOUTH_KEYS = ["aa", "ih", "ou", "ee", "oh"] as const;

/**
 * Oculus 15 visemes → VRM's 5 mouth shapes. Vowels map 1:1; consonants get the
 * partial mouth they make. PP is absent on purpose: it drives `closure`.
 */
const OCULUS_TO_VRM: Record<string, Partial<MouthState>> = {
  aa: { aa: 1 },
  E: { ee: 0.7, aa: 0.3 },
  I: { ih: 1 },
  O: { oh: 1 },
  U: { ou: 1 },
  FF: { ih: 0.2 },
  TH: { ih: 0.3, aa: 0.1 },
  DD: { ih: 0.3, aa: 0.2 },
  kk: { aa: 0.3, ih: 0.2 },
  CH: { ou: 0.4, ee: 0.3 },
  SS: { ih: 0.4, ee: 0.2 },
  nn: { ih: 0.25 },
  RR: { ou: 0.4, oh: 0.2 },
};

/** HeadAudio's own ceiling for the PP blend value (its `visemeMaxs`). */
const PP_MAX = 0.75;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Maps HeadAudio's per-viseme blend values (keys without the `viseme_` prefix)
 * to a normalized VRM mouth shape plus a bilabial closure factor.
 */
export function oculusToMouth(values: Readonly<Record<string, number>>): ShapeFrame {
  const shape: MouthState = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
  for (const [viseme, value] of Object.entries(values)) {
    const map = OCULUS_TO_VRM[viseme];
    if (!map || !(value > 0)) continue;
    for (const key of MOUTH_KEYS) shape[key] += value * (map[key] ?? 0);
  }
  const max = Math.max(...MOUTH_KEYS.map((k) => shape[k]));
  if (max > 1e-3) {
    for (const key of MOUTH_KEYS) shape[key] /= max;
  } else {
    for (const key of MOUTH_KEYS) shape[key] = 0;
  }
  return { shape, closure: clamp01((values.PP ?? 0) / PP_MAX) };
}

export function isHeadAudioSupported(ctx: BaseAudioContext): boolean {
  const secure = typeof globalThis.isSecureContext === "boolean" ? globalThis.isSecureContext : true;
  return typeof AudioWorkletNode !== "undefined" && !!ctx.audioWorklet && secure;
}

// The processor name can only be registered once per context.
const registrations = new WeakMap<BaseAudioContext, Promise<void>>();

function blobUrl(content: BlobPart, type: string): string {
  return URL.createObjectURL(new Blob([content], { type }));
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function registerWorklet(ctx: BaseAudioContext): Promise<void> {
  let registration = registrations.get(ctx);
  if (!registration) {
    const url = blobUrl(HEADWORKLET_SOURCE, "text/javascript");
    registration = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    registrations.set(ctx, registration);
    registration.catch(() => registrations.delete(ctx));
  }
  return registration;
}

interface HeadAudioNode extends AudioWorkletNode {
  loadModel(url: string, reset?: boolean): Promise<void>;
  update(deltaMs: number): void;
  onvalue: ((key: string, value: number) => void) | null;
}

// The vendored build is untyped (@ts-nocheck); this is its real constructor shape.
type HeadAudioNodeCtor = new (
  context: BaseAudioContext,
  options: { processorOptions: Record<string, unknown>; parameterData: Record<string, number> },
) => HeadAudioNode;

/** @throws when AudioWorklet is unavailable, outside a secure context, or the model fails to load. */
export async function createHeadAudioShapeSource(ctx: BaseAudioContext): Promise<ShapeSource> {
  if (!isHeadAudioSupported(ctx)) {
    throw new Error("HeadAudio requires AudioWorklet in a secure context");
  }
  await registerWorklet(ctx);
  // Imported lazily: the vendored class extends AudioWorkletNode at module
  // evaluation, which throws wherever that global doesn't exist (SSR, Node).
  const { HeadAudio } = await import("./vendor/headaudio-node");
  const HeadAudioNode = HeadAudio as unknown as HeadAudioNodeCtor;

  // silMode 0: use the model's trained silence prototypes; manual mode would
  // need the app to run a silence-calibration window first.
  const node = new HeadAudioNode(ctx, { processorOptions: {}, parameterData: { silMode: 0 } });
  const modelUrl = blobUrl(base64ToBytes(HEADAUDIO_MODEL_BASE64), "application/octet-stream");
  try {
    await node.loadModel(modelUrl);
  } catch (error) {
    node.disconnect();
    throw error;
  } finally {
    URL.revokeObjectURL(modelUrl);
  }

  const values: Record<string, number> = {};
  node.onvalue = (key, value) => {
    values[key.startsWith("viseme_") ? key.slice(7) : key] = value;
  };

  return {
    input: node,
    update(deltaMs) {
      node.update(deltaMs);
      return oculusToMouth(values);
    },
    dispose() {
      node.onvalue = null;
      node.disconnect();
      node.port.close();
    },
  };
}
