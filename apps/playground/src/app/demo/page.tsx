'use client';

/**
 * demo — render-quality evaluation surface: the avatar in a realistic
 * presentation context (in-scene backdrop + chat overlay), rather than the
 * bare grey canvas the *-avatar-test pages use.
 *
 * The backdrop is an in-canvas plane (AvatarBackdrop) rather than a CSS
 * background so it shares the scene's tone mapping and sits at a finite
 * depth the avatar can be composed against.
 *
 * Dev/demo page only — not shipped SDK surface.
 */
import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OpenAIRealtimeProvider } from '@khaveeai/providers-openai-realtime';
import { toolGesture, createEmotionTool, emotionSystemPrompt } from '@khaveeai/core';
import {
  KhaveeProvider,
  VRMAvatar,
  AvatarBackdrop,
  AvatarCamera,
  AvatarPostFX,
  ShadowFloor,
  useRealtime,
  useKhavee,
  type AnimationConfig,
  type AvatarBackground,
} from '@khaveeai/react';

const openaiProvider = new OpenAIRealtimeProvider({
  useProxy: true,
  proxyEndpoint: '/api/negotiate',
  voice: 'shimmer',
  instructions:
    'You are a warm, friendly companion. Keep replies short and conversational — a couple of sentences at most. ' +
    emotionSystemPrompt,
});

// Same shape khavee-app ships. Array entries flatten to `${key}_0`, `_1`…,
// so the key prefix still matches STATUS_CLIP_PATTERNS, and the status clip
// cycler rotates every variant for ready/listening/thinking/speaking at loop
// boundaries (not just speaking, as before 0.5.5).
const AVATAR_ANIMATIONS: AnimationConfig = {
  idle: [
    '/models/animations/khavee/idle_stand_still.fbx',
    '/models/animations/khavee/idle_look_left.fbx',
    '/models/animations/khavee/idle_look_right.fbx',
    '/models/animations/khavee/idle_look_left_and_right.fbx',
  ],
  speaking: [
    '/models/animations/khavee/speaking01.fbx',
    '/models/animations/khavee/speaking02.fbx',
  ],
  thinking: [
    '/models/animations/khavee/thinking01.fbx',
    '/models/animations/khavee/thinking02.fbx',
  ],
  greeting: '/models/animations/khavee/wave.fbx',
};

const PRESET_BACKGROUNDS: { label: string; background: AvatarBackground }[] = [
  { label: 'Studio', background: { type: 'color', value: '#2b2f3a' } },
  { label: 'Warm', background: { type: 'color', value: '#e8d5c4' } },
  { label: 'Sky', background: { type: 'color', value: '#9ec5e8' } },
];

interface Quality {
  postfx: boolean;
  bloom: boolean;
  dof: boolean;
  vignette: boolean;
  grading: boolean;
  smaa: boolean;
  outlines: boolean;
  smoothShading: boolean;
}

const DEFAULT_QUALITY: Quality = {
  // bloom off by default matching khavee-app's own judgement that the default
  // glow is too strong on these models.
  postfx: true,
  bloom: false,
  dof: false,
  vignette: false,
  grading: false,
  smaa: true,
  outlines: false,
  smoothShading: false,
};

/** Suits a person-scale avatar; the prop is clamped to 0–0.05 upstream. */
const OUTLINE_WIDTH = 0.0025;

const QUALITY_TOGGLES: { key: keyof Quality; label: string; hint: string }[] = [
  { key: 'postfx', label: 'Post-processing', hint: 'Master switch for the AvatarPostFX chain' },
  { key: 'smaa', label: 'SMAA', hint: 'Subpixel morphological anti-aliasing, on top of the Canvas MSAA' },
  { key: 'bloom', label: 'Bloom', hint: 'Glow on bright highlights' },
  {
    key: 'dof',
    label: 'Depth of field',
    hint: 'Focus tracks the subject\'s live camera distance. Transparent face details (lashes, brows) do not write depth, so they stay sharp.',
  },
  { key: 'vignette', label: 'Vignette', hint: 'Spatial falloff darkening toward the frame edges' },
  { key: 'grading', label: 'Colour grading', hint: 'Hue/saturation plus brightness/contrast' },
  {
    key: 'outlines',
    label: 'Toon outlines',
    hint: 'Outlines every opaque MToon surface. Most assets author none — remounts the avatar.',
  },
  {
    key: 'smoothShading',
    label: 'Smooth shading',
    hint: 'Welds coincident vertices and recomputes normals. Mutates geometry — remounts the avatar.',
  },
];

function Scene({
  background,
  quality,
}: {
  background: AvatarBackground;
  quality: Quality;
}) {
  return (
    <>
      <AvatarBackdrop background={background} />
      <Suspense fallback={null}>
        <VRMAvatar
          // outlineWidth and smoothShading are both applied at load time
          // (smoothShading mutates geometry), so they only take effect on a
          // fresh mount — remount the avatar when either changes.
          key={`${quality.outlines}:${quality.smoothShading}`}
          src="/models/female/nongkhavee_female_06.vrm"
          animations={AVATAR_ANIMATIONS}
          enableBlinking
          animationCycleOrder="random"
          animationMinDwellSeconds={4}
          outlineWidth={quality.outlines ? OUTLINE_WIDTH : undefined}
          smoothShading={quality.smoothShading}
        />
      </Suspense>
      {/* The light rig casts shadows, but nothing in this scene received them:
          the avatar only self-shadows and the backdrop plane sits at distance 6,
          outside the key light's -2..2 shadow frustum. */}
      <ShadowFloor y={0} opacity={0.35} />
      {/* AvatarCamera, not OrbitControls: it owns the framing preset plus the
          procedural handheld drift and the speaking-state dolly. A plain
          OrbitControls + static Canvas camera has neither. */}
      <AvatarCamera preset="bust-shot" orbit="locked" drift={false} reframe />
      {quality.postfx && (
        <AvatarPostFX
          bloom={quality.bloom}
          dof={quality.dof}
          vignette={quality.vignette}
          grading={quality.grading}
          smaa={quality.smaa}
        />
      )}
    </>
  );
}

function MicIcon({ muted = false }: { muted?: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
      {muted && <path d="M3 3l18 18" />}
    </svg>
  );
}

function ChatBox() {
  const {
    connect,
    sendMessage,
    conversation,
    isConnected,
    chatStatus,
    isMicEnabled,
    toggleMicrophone,
  } = useRealtime();
  const [input, setInput] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [conversation, chatStatus]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    sendMessage(text);
    setInput('');
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-3xl bg-white/85 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
        <h2 className="font-semibold text-gray-800">Chat</h2>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">
            {chatStatus}
          </span>
          {isConnected && (
            <button
              onClick={() => void toggleMicrophone()}
              title={isMicEnabled ? 'Mute microphone' : 'Enable microphone'}
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors ${
                isMicEnabled
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
              }`}
            >
              {isMicEnabled ? (
                <MicIcon />
              ) : (
                <MicIcon muted />
              )}
            </button>
          )}
        </div>
      </div>

      {!isConnected ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-sm text-gray-500">
            Connect to start talking. Use your mic, or type below.
          </p>
          <button
            onClick={connect}
            disabled={chatStatus === 'starting'}
            className="rounded-full bg-blue-600 px-6 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {chatStatus === 'starting' ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      ) : (
        <>
          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-5">
            {conversation.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] px-4 py-2.5 text-sm ${
                    msg.role === 'user'
                      ? 'rounded-3xl rounded-br-md bg-blue-600 text-white'
                      : 'rounded-3xl rounded-bl-md bg-gray-100 text-gray-800'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            {chatStatus === 'thinking' && (
              <div className="flex justify-start">
                <div className="rounded-3xl rounded-bl-md bg-gray-100 px-4 py-3">
                  <span className="inline-flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-black/5 p-4">
            <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white pl-4 pr-1.5 py-1.5">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Type a message…"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="shrink-0 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DemoPage() {
  const { setGestureHint, setEmotionHint } = useKhavee();
  const [background, setBackground] = useState<AvatarBackground>(
    PRESET_BACKGROUNDS[0].background,
  );
  const [quality, setQuality] = useState<Quality>(DEFAULT_QUALITY);
  const objectUrl = useRef<string | null>(null);

  useEffect(() => {
    openaiProvider.registerFunction({
      ...toolGesture,
      execute: async (args) => {
        setGestureHint(args?.gesture ?? null);
        return { success: true, message: `gesture: ${args?.gesture}` };
      },
    });
  }, [setGestureHint]);

  useEffect(() => {
    openaiProvider.registerFunction(createEmotionTool(setEmotionHint).tool);
  }, [setEmotionHint]);

  // Revoke the previous object URL only after a new one replaces it, and on
  // unmount — revoking while the texture is still decoding blanks the plane.
  useEffect(() => {
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    const url = URL.createObjectURL(file);
    objectUrl.current = url;
    setBackground({ type: 'image', url, fit: 'cover' });
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <Canvas shadows>
        <Scene background={background} quality={quality} />
      </Canvas>

      {/* Quality A/B panel — every row is an SDK render-quality feature that
          is off unless opted into, so each can be judged in isolation. */}
      <div className="absolute bottom-6 left-6 w-56 rounded-2xl bg-white/85 p-4 shadow-lg backdrop-blur-md">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Render quality
        </h3>
        <div className="space-y-1.5">
          {QUALITY_TOGGLES.map(({ key, label, hint }) => (
            <label
              key={key}
              title={hint}
              className="flex cursor-pointer items-center gap-2.5 text-sm text-gray-700"
            >
              <input
                type="checkbox"
                checked={quality[key]}
                onChange={(e) =>
                  setQuality((q) => ({ ...q, [key]: e.target.checked }))
                }
                className="h-3.5 w-3.5 accent-blue-600"
              />
              {label}
            </label>
          ))}
        </div>
        <button
          onClick={() => setQuality(DEFAULT_QUALITY)}
          className="mt-3 w-full rounded-full bg-gray-100 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200"
        >
          Reset
        </button>
      </div>

      {/* Backdrop picker */}
      <div className="absolute left-6 top-6 flex items-center gap-2 rounded-full bg-white/85 px-2 py-2 shadow-lg backdrop-blur-md">
        {PRESET_BACKGROUNDS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => setBackground(preset.background)}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
          >
            {preset.label}
          </button>
        ))}
        <label className="cursor-pointer rounded-full bg-gray-900 px-3 py-1.5 text-xs font-medium text-white">
          Image…
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </label>
      </div>

      {/* Chat overlay */}
      <div className="absolute bottom-6 right-6 top-6 w-[380px] max-w-[calc(100vw-3rem)]">
        <ChatBox />
      </div>
    </div>
  );
}

export default function Demo() {
  return (
    <KhaveeProvider config={{ realtime: openaiProvider }}>
      <DemoPage />
    </KhaveeProvider>
  );
}
