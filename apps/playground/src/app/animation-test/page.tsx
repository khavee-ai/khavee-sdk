'use client';

/**
 * animation-test — side-by-side VRM + GLB manual-verification surface for
 * the full natural-motion stack (breathing, sway, gaze, gesture, blink,
 * expression drift, talk-cycle), driven by a real OpenAIRealtimeProvider
 * session so chatStatus actually cycles through ready/listening/thinking/
 * speaking instead of staying "stopped" (gaze/breathing/sway/gesture are
 * all no-ops in "stopped" — see 12-10-SUMMARY.md).
 *
 * Both avatars share one KhaveeProvider, so they observe the same
 * chatStatus/gestureHint at the same time — orbit either camera to compare
 * camera-relative gaze behavior between formats.
 *
 * Dev/test page only — not shipped SDK surface.
 */
import { Suspense, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { OpenAIRealtimeProvider } from '@khaveeai/providers-openai-realtime';
import { toolGesture } from '@khaveeai/core';
import {
  KhaveeProvider,
  VRMAvatar,
  GLBAvatar,
  AvatarPostFX,
  ShadowFloor,
  useRealtime,
  useKhavee,
  type AnimationConfig,
} from '@khaveeai/react';

const openaiProvider = new OpenAIRealtimeProvider({
  useProxy: true,
  proxyEndpoint: '/api/negotiate',
  voice: 'shimmer',
  instructions:
    'You are a helpful, conversational AI assistant. Keep responses natural and not too long, so animation transitions are easy to observe.',
});

// Bundled Mixamo FBX fixtures (D-03) — without clips loaded, resolveBaseClip
// always returns null and VRMAvatar never crossfades (stays in bind pose).
//
// Key names (not filenames) are what resolveBaseClip pattern-matches against
// STATUS_CLIP_PATTERNS (AnimationStateEngine.ts) — VRMAvatar renames each
// loaded clip to its AnimationConfig key. "welcome"/"goodbye" are placeholder
// picks (no dedicated greet/farewell clip exists yet, D-01/issue #17) reusing
// wave.fbx/sad.fbx; swap freely once real clips land.
const VRM_ANIMATIONS: AnimationConfig = {
  idle: '/models/animations/mk.fbx', // ready (/idle|ready|rest/i)
  // talking: '/models/animations/talk.fbx', // speaking (/talk|gesture|speak|taking/i)
  // talking1: '/models/animations/talk2.fbx', // TALK-01 variant cycling
  // talking2: '/models/animations/talk3.fbx', // TALK-01 variant cycling
  // thinking: '/models/animations/thinking.fbx', // thinking (/think/i)
  // welcome: '/models/animations/wave.fbx', // starting (/welcome|greet|hello|intro/i)
  // listening: '/models/animations/thinking2.fbx', // listening (/listen|hear/i)
  // goodbye: '/models/animations/sad.fbx', // stopped (/stop|bye|goodbye|outro/i)
};

function VRMScene() {
  return (
    <>
      {/* No manual lights — VRMAvatar's `autoLighting` (default true) mounts
          its own AvatarLightRig (ambient + shadow-casting directional) via
          the new renderQuality.tsx helper. castShadow/receiveShadow/
          anisotropy/toneMapping all default on too — zero extra props. */}
      <Suspense fallback={null}>
        <VRMAvatar src="models/male/vroid.vrm" animations={VRM_ANIMATIONS} enableBlinking  />
      </Suspense>
      <ShadowFloor />
      <OrbitControls target={[0, 1, 0]} />
      <AvatarPostFX bloomIntensity={0.5} bloomThreshold={0.2} bloomSmoothing={1.5} />
    </>
  );
}

function GLBScene() {
  return (
    <>
      {/* Same story as VRMScene — GLBAvatar's own AvatarLightRig replaces
          the manual ambient+directional lights this page used to hand-roll. */}
      <Suspense fallback={null}>
        {/* happy.glb's embedded clips are matched by resolveBaseClip's
            naming-convention patterns — no explicit `animations` prop needed. */}
        <GLBAvatar src="/models/happy.glb"  />
      </Suspense>
      <ShadowFloor />
      <OrbitControls target={[0, 1, 0]} />
      <AvatarPostFX bloomIntensity={0.2} bloomThreshold={1} bloomSmoothing={3} />
    </>
  );
}

function AnimationTestPage() {
  const { connect, disconnect, sendMessage, conversation, isConnected, chatStatus } = useRealtime();
  const { setGestureHint } = useKhavee();

  // GEST-01/02 wiring — same pattern as openai-avatar-test: register inside
  // the tree so `execute` can reach the public `setGestureHint` setter.
  useEffect(() => {
    openaiProvider.registerFunction({
      ...toolGesture,
      execute: async (args) => {
        setGestureHint(args?.gesture ?? null);
        return { success: true, message: `gesture: ${args?.gesture}` };
      },
    });
  }, [setGestureHint]);

  return (
    <div className="flex h-screen flex-col">
      <div className="flex-none bg-gray-50 p-4 border-b border-gray-200">
        <h1 className="text-2xl font-bold mb-1">Animation Test — VRM + GLB side by side</h1>
        <p className="text-sm text-gray-600 mb-3">
          Connect, then watch both avatars for: idle breathing/sway (spine+chest only, no
          head/legs), camera-relative gaze (orbit either camera — head softly tracks it in
          ready/listening/speaking, averts briefly in thinking, no gaze in starting/stopped),
          blink, expression drift, talk-cycle clip switching while speaking, and nod/shake
          gesture pulses (manual buttons below, or via the assistant&apos;s{' '}
          <code>set_gesture</code> tool call) which only fire at the next natural loop
          boundary — never mid-clip.
        </p>
        <div className="flex gap-4 items-center flex-wrap">
          <button
            onClick={connect}
            disabled={isConnected}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50"
          >
            {isConnected ? 'Connected' : 'Connect'}
          </button>
          <button
            onClick={disconnect}
            disabled={!isConnected}
            className="px-6 py-2 bg-red-600 text-white rounded-lg disabled:opacity-50"
          >
            Disconnect
          </button>
          <div className="px-4 py-2 bg-gray-100 rounded-lg">Status: {chatStatus}</div>
          <button
            onClick={() => setGestureHint('nod')}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg"
          >
            Nod
          </button>
          <button
            onClick={() => setGestureHint('shake')}
            className="px-6 py-2 bg-purple-600 text-white rounded-lg"
          >
            Shake
          </button>
        </div>

        {/* Message box — same sendMessage/conversation pattern as
            openai-avatar-test, kept compact since the 3D canvases below
            take most of the screen. Text fallback for when mic/voice isn't
            convenient to test with. */}
        <div className="mt-3 flex flex-col gap-2">
          <div className="max-h-32 overflow-y-auto bg-white border border-gray-200 rounded-lg p-2 space-y-1">
            {conversation.length === 0 ? (
              <div className="text-xs text-gray-400 italic">No messages yet</div>
            ) : (
              conversation.map((msg) => (
                <div
                  key={msg.id}
                  className={`text-sm px-2 py-1 rounded ${
                    msg.role === 'user' ? 'bg-blue-100 ml-8' : 'bg-gray-100 mr-8'
                  }`}
                >
                  <span className="font-semibold text-xs mr-1">
                    {msg.role === 'user' ? 'You:' : 'AI:'}
                  </span>
                  {msg.text}
                </div>
              ))
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem('message') as HTMLInputElement;
              if (input.value.trim()) {
                sendMessage(input.value.trim());
                input.value = '';
              }
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              name="message"
              placeholder="Type a message (fallback if mic isn't available)..."
              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50"
              disabled={!isConnected}
            />
            <button
              type="submit"
              disabled={!isConnected}
              className="px-4 py-1.5 text-sm bg-green-600 text-white rounded-lg disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-full h-full border-r border-gray-200 bg-gray-800 relative">
          <div className="absolute top-2 left-2 z-10 px-2 py-1 bg-black/60 text-white text-xs rounded font-mono">
            VRM — male.vrm
          </div>
          <Canvas camera={{ position: [0, 1.5, 3], fov: 50 }} shadows>
            <VRMScene />
          </Canvas>
        </div>
        {/* <div className="w-1/2 h-full relative "  style={{ background: '#3353FF' }}>
          <div className="absolute top-2 left-2 z-10 px-2 py-1 bg-black/60 text-white text-xs rounded font-mono">
            GLB — happy.glb
          </div>
          <Canvas camera={{ position: [0, 1, 3], fov: 50 }} shadows>
            <GLBScene />
          </Canvas>
        </div> */}
      </div>
    </div>
  );
}

export default function AnimationTest() {
  return (
    <KhaveeProvider config={{ realtime: openaiProvider }}>
      <AnimationTestPage />
    </KhaveeProvider>
  );
}
