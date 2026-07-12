'use client';

/**
 * openai-avatar-test — manual-verification surface wiring the full-duplex
 * OpenAIRealtimeProvider together with the SDK's VRMAvatar (Phase 10
 * shared-animation-architecture-crossfade-engine).
 *
 * Unlike glb-avatar-test/vrm-avatar-test (button-triggered test clips),
 * this page exercises the shared animation module's chatStatus-driven
 * crossfades AND the pre-existing phoneme-lipsync system against a real
 * OpenAI Realtime voice conversation — the closest approximation of
 * production usage available in this repo.
 *
 * Dev/test page only — not shipped SDK surface.
 */
import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { OpenAIRealtimeProvider } from '@khaveeai/providers-openai-realtime';
import { KhaveeProvider, VRMAvatar, useRealtime, type AnimationConfig } from '@khaveeai/react';

const openaiProvider = new OpenAIRealtimeProvider({
  useProxy: true,
  proxyEndpoint: '/api/negotiate',
  voice: 'shimmer',
  instructions:
    'You are a helpful, conversational AI assistant. Keep responses natural and not too long, so lipsync and animation transitions are easy to observe.',
});

// Bundled Mixamo FBX fixtures (D-03) — without clips loaded, resolveBaseClip
// always returns null and the avatar never crossfades (stays in bind pose).
// "talking" matches resolveBaseClip's /talk|gesture|speak/i check, so it
// plays automatically whenever chatStatus becomes "speaking".
const AVATAR_ANIMATIONS: AnimationConfig = {
  idle: '/models/animations/Idle.fbx',
  talking: '/models/animations/talking.fbx',
  talking1: '/models/animations/talking1.fbx',
};

function Scene() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <Suspense fallback={null}>
        <VRMAvatar src="/models/male.vrm" animations={AVATAR_ANIMATIONS} enableBlinking />
      </Suspense>
      <OrbitControls target={[0, 1, 0]} />
    </>
  );
}

function OpenAIAvatarTestPage() {
  const { connect, disconnect, sendMessage, conversation, isConnected, chatStatus } = useRealtime();

  return (
    <div className="flex h-screen">
      {/* Left side - 3D Scene with Avatar */}
      <div className="w-1/2 h-full">
        <Canvas camera={{ position: [0, 1.5, 3], fov: 50 }} shadows>
          <Scene />
        </Canvas>
      </div>

      {/* Right side - Chat UI */}
      <div className="w-1/2 h-full bg-gray-50 p-8 flex flex-col">
        <div className="flex-none">
          <h1 className="text-3xl font-bold mb-2">OpenAI Realtime Avatar Test</h1>
          <p className="text-sm text-gray-600 mb-6">
            Speak into your mic after connecting. Watch for: lips moving in sync with AI speech
            audio, and smooth animated transitions as chatStatus changes (idle -&gt; listening -&gt;
            thinking -&gt; speaking).
          </p>

          <div className="flex gap-4 mb-6">
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
            <div className="px-4 py-2 bg-gray-100 rounded-lg">
              Status: {chatStatus}
            </div>
          </div>
        </div>

        <div className="flex-1 bg-white rounded-lg shadow p-6 space-y-4 overflow-y-auto">
          {conversation.map((msg) => (
            <div
              key={msg.id}
              className={`p-3 rounded ${msg.role === 'user' ? 'bg-blue-100 ml-8' : 'bg-gray-100 mr-8'}`}
            >
              <div className="font-semibold text-sm mb-1">
                {msg.role === 'user' ? 'You' : 'AI'}
              </div>
              <div>{msg.text}</div>
            </div>
          ))}
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
          className="mt-6 flex-none"
        >
          <input
            type="text"
            name="message"
            placeholder="Type a message (fallback if mic isn't available)..."
            className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:opacity-50"
            disabled={!isConnected}
          />
          <button
            type="submit"
            disabled={!isConnected}
            className="mt-2 w-full px-4 py-2 bg-green-600 text-white rounded-lg disabled:opacity-50"
          >
            Send Message
          </button>
        </form>
      </div>
    </div>
  );
}

export default function OpenAIAvatarTest() {
  return (
    <KhaveeProvider config={{ realtime: openaiProvider }}>
      <OpenAIAvatarTestPage />
    </KhaveeProvider>
  );
}
