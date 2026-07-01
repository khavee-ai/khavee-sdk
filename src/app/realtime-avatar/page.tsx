'use client';

import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { OpenAIRealtimeProvider } from '@khaveeai/providers-openai-realtime';
import { KhaveeProvider, VRMAvatar, useRealtime } from '@khaveeai/react';

const openaiProvider = new OpenAIRealtimeProvider({
  useProxy: true,
  proxyEndpoint: '/api/negotiate',
  voice: 'shimmer',
  instructions: 'You are a helpful AI assistant. Be conversational and friendly.',
});

// Animation keys follow the chatStatus auto-mapping convention (Phase 11):
// "idle" backs chatStatus === "ready"; "listening"/"thinking"/"speaking" map
// 1:1 to their chatStatus values.
//
// "listening"/"thinking" intentionally reuse the calm idle pose rather than an
// energetic talking/gesture clip — the procedural layer (nod during listening,
// head-tilt + gaze-aversion during thinking) is what conveys those states. Using
// an energetic gesture clip for "thinking" combined with those same procedural
// effects looked like the torso bending / head spinning erratically.
// "speaking"/"speaking2" are the only keys that intentionally use energetic
// talking clips (matched via /speak|talk|gesture/i for variety on each pick).
const animations = {
  idle: '/models/animations/Idle.fbx',
  listening: '/models/animations/Idle.fbx',
  thinking: '/models/animations/Idle.fbx',
  speaking: '/models/animations/talking.fbx',
  speaking2: '/models/animations/talking1.fbx',
};

function Avatar() {
  const { chatStatus } = useRealtime();

  return (
    <div style={{ position: 'relative', width: '100%', height: '70vh', background: '#20232a', borderRadius: 12, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 10,
          padding: '6px 12px',
          borderRadius: 6,
          background: 'rgba(0,0,0,0.5)',
          color: '#6ee7ff',
          fontFamily: 'monospace',
          fontSize: 13,
        }}
      >
        chatStatus: <b>{chatStatus}</b>
      </div>
      <Canvas
        camera={{ position: [0, 1.4, 3], fov: 20 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        {/* VRM avatars use MToon toon-shading, not PBR — strong multi-directional
            rigs and environment reflections read as harsh/plasticky on that
            material. Soft look = bright even ambient doing most of the work,
            plus one gentle light for just enough shape definition. */}
        <hemisphereLight args={['#fff6ea', '#3a3630', 1.1]} />
        <ambientLight intensity={0.35} color="#fff2e0" />
        <directionalLight position={[1, 3, 3]} intensity={0.45} color="#fff4e6" />
        {/* Very low-intensity ambient environment for a touch of soft reflection,
            without introducing harsh specular highlights. */}
        <Environment preset="apartment" environmentIntensity={0.12} />
        <VRMAvatar src="/models/female/blue-female.vrm" position={[0,1,0]} animations={animations} />
        <OrbitControls target={[0, 1.2, 0]} />
      </Canvas>
    </div>
  );
}

function RealtimeChat() {
  const { connect, disconnect, sendMessage, conversation, isConnected } = useRealtime();

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">VRM Avatar — OpenAI Realtime Voice</h1>

        <Avatar />

        <div className="flex gap-4 my-6">
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
        </div>

        <div className="bg-white rounded-lg shadow p-6 space-y-4 max-h-96 overflow-y-auto">
          {conversation.map((msg) => (
            <div
              key={msg.id}
              className={`p-3 rounded ${
                msg.role === 'user' ? 'bg-blue-100 ml-8' : 'bg-gray-100 mr-8'
              }`}
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
              sendMessage(input.value);
              input.value = '';
            }
          }}
          className="mt-4"
        >
          <input
            name="message"
            type="text"
            placeholder="Type a message..."
            disabled={!isConnected}
            className="w-full px-4 py-2 border rounded-lg disabled:opacity-50"
          />
        </form>

        <p className="text-sm text-gray-500 mt-4">
          Click Connect, then either speak (mic) or type a message. Watch the avatar:
          lower body should stay on a continuous idle loop while the upper body crossfades
          into listening/thinking/speaking poses.
        </p>
      </div>
    </div>
  );
}

export default function RealtimeAvatarPage() {
  return (
    <KhaveeProvider config={{ realtime: openaiProvider }}>
      <RealtimeChat />
    </KhaveeProvider>
  );
}
