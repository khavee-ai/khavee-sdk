'use client';

import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { OpenAIRealtimeProvider } from '@khaveeai/providers-openai-realtime';
import { KhaveeProvider, VRMAvatar, useRealtime, useKhavee } from '@khaveeai/react';
import { createEmotionTool, type ConversationEmotion } from '@khaveeai/core';

// The provider is instantiated at module scope (outside React), but the
// emotion tool's `execute` needs to reach `setMultipleExpressions`, which
// only exists inside the KhaveeProvider tree via useKhavee(). This ref is
// the bridge: the tool always calls whatever's in `.current`, and the
// EmotionBridge component below (mounted inside the provider) keeps it
// pointed at the live setter. The tool itself must still be passed into
// `tools` here at construction time — that's what gets its schema sent to
// OpenAI's session; registering it later via registerFunction() would only
// wire up local dispatch, not tell the model the tool exists at all.
const emotionBridge: { current: (emotion: ConversationEmotion) => void } = {
  current: () => {},
};

const emotionTool = createEmotionTool({
  onEmotion: (emotion) => emotionBridge.current(emotion),
});

const openaiProvider = new OpenAIRealtimeProvider({
  useProxy: true,
  proxyEndpoint: '/api/negotiate',
  voice: 'shimmer',
  instructions:
    'You are a helpful AI assistant. Be conversational and friendly. ' +
    'Whenever you notice the emotional tone of the conversation shift — the user seems happy or pleased, ' +
    'or the user seems upset, hostile, or is arguing with you — call the report_emotion tool with your read of it. ' +
    'Call it again with "neutral" once the tone returns to normal.',
  tools: [emotionTool],
});

// Mounted inside KhaveeProvider so it can reach setMultipleExpressions and
// keep the module-scope emotionBridge pointed at the current one.
function EmotionBridge() {
  const { setMultipleExpressions } = useKhavee();

  useEffect(() => {
    emotionBridge.current = (emotion) => {
      setMultipleExpressions({
        happy: emotion === 'happy' ? 1 : 0,
        sad: emotion === 'sad' ? 1 : 0,
      });
    };
    return () => {
      emotionBridge.current = () => {};
    };
  }, [setMultipleExpressions]);

  return null;
}

// Animation keys follow the chatStatus auto-mapping convention (Phase 11):
// "idle" backs chatStatus === "ready"; "listening"/"thinking"/"speaking" map
// 1:1 to their chatStatus values.
//
// "listening"/"thinking" reuse the calm idle pose — the procedural layer
// (nod during listening, head-tilt during thinking) is what conveys those
// states. "speaking" swaps to a real Mixamo talking clip; the upper-body
// crossfade into/out of it is handled by VRMAvatar.tsx's D-12 eased +
// pose-distance-adaptive blend, which replaces the previous fixed-duration
// linear crossfade specifically to make independently-authored clips like
// this one blend as smoothly as achievable in code.
const animations = {
  idle: '/models/animations/Idle.fbx',
  listening: '/models/animations/Idle.fbx',
  thinking: '/models/animations/talking1.fbx',
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
        <VRMAvatar
          src="/models/female/blue-female.vrm"
          position={[0,1,0]}
          animations={animations}
          enableEmotionDetection={false}
        />
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

        <EmotionBridge />
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
