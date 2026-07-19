'use client';

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { GenericPipelineProvider, OpenAILLMAdapter, OpenAIVADAdapter } from '@khaveeai/providers-generic-stt-tts';
import { KhaveeProvider, VRMAvatar, useRealtime } from '@khaveeai/react';
import { ThonburianSTTAdapter } from './adapters/ThonburianSTTAdapter';
import { JaiTTSAdapter } from './adapters/JaiTTSAdapter';

// Create pipeline providers
const vad = new OpenAIVADAdapter();
const stt = new ThonburianSTTAdapter();
const llm = new OpenAILLMAdapter({
  endpoint: '/api/generic-chat-proxy',
  authToken: 'local-dev',
  model: 'gpt-4o-mini',
});
const tts = new JaiTTSAdapter();

const genericProvider = new GenericPipelineProvider({
  vad,
  stt,
  llm,
  tts,
  micReopenCooldownMs: 500,
});

function Scene() {
  return (
    <>
      {/* No manual lights — VRMAvatar's autoLighting (default true)
          mounts its own AvatarLightRig (renderQuality.tsx). */}
      <Suspense fallback={null}>
        <VRMAvatar src="/models/male.vrm" />
      </Suspense>
      <OrbitControls target={[0, 1, 0]} />
    </>
  );
}

function GenericDemoPage() {
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
          <h1 className="text-3xl font-bold mb-6">Generic Pipeline Demo</h1>

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
            placeholder="Type a message..."
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

        <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200 flex-none">
          <h2 className="font-semibold text-blue-900 mb-2">Pipeline Status</h2>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>✓ STT: ThonburianSTTAdapter (localhost:8001) - Thai Whisper</li>
            <li>✓ LLM: OpenAILLMAdapter (GPT-4o-mini via server proxy)</li>
            <li>✓ TTS: JaiTTSAdapter (localhost:8002) - Thai voice cloning</li>
            <li>✓ VAD: OpenAIVADAdapter (real mic via MicVAD)</li>
          </ul>
          <p className="mt-2 text-xs text-blue-700">
            Avatar lip-sync driven by phoneme detection from TTS audio stream
          </p>
        </div>
      </div>
    </div>
  );
}

export default function GenericDemoPageWrapper() {
  return (
    <KhaveeProvider config={{ realtime: genericProvider }}>
      <GenericDemoPage />
    </KhaveeProvider>
  );
}
