'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
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
const animations = {
  idle: '/models/animations/Idle.fbx',
  listening: '/models/animations/talking1.fbx',
  thinking: '/models/animations/talking.fbx',
  speaking: '/models/animations/talking.fbx',
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
      <Canvas camera={{ position: [0, 1.4, 3], fov: 35 }}>
        <ambientLight intensity={1} />
        <directionalLight position={[2, 4, 3]} intensity={2} />
        <VRMAvatar src="/models/male.vrm" animations={animations} />
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
