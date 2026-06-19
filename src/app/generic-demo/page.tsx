'use client';

import { GenericPipelineProvider, OpenAILLMAdapter } from '@khaveeai/providers/generic-stt-tts';
import { KhaveeProvider, useRealtime } from '@khaveeai/react';
import { VADProvider, LLMProvider, TTSProvider } from '@khaveeai/core';
import { ThonburianSTTAdapter } from './adapters/ThonburianSTTAdapter';
import { JaiTTSAdapter } from './adapters/JaiTTSAdapter';

// ── VAD remains mock (will use real MicVAD in polish phase) ─────────────────

class MockVADProvider implements VADProvider {
  readonly name = 'mock-vad';
  readonly supportsStreaming = false;

  async start(opts?: { sampleRate?: number }): Promise<void> {
    console.log('[MockVAD] started');
  }

  stop(): void {
    console.log('[MockVAD] stopped');
  }

  onSpeechStart?: (callback: () => void) => void;
  onSpeechEnd?: (callback: (audio: Blob) => void) => void;
  onError?: (callback: (error: Error) => void) => void;
}

// ── Pipeline instantiation ─────────────────────────────────────────────────────
// All four stages: VAD (mock), STT (real), LLM (real), TTS (real)

const vad = new MockVADProvider();
const stt = new ThonburianSTTAdapter();
const llm = new OpenAILLMAdapter({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY || '',
  model: 'gpt-4o',
});
const tts = new JaiTTSAdapter();

const genericProvider = new GenericPipelineProvider({
  vad,
  stt,
  llm,
  tts,
  micReopenCooldownMs: 500,
});

function GenericDemoPage() {
  const { connect, disconnect, sendMessage, conversation, isConnected, chatStatus } = useRealtime();

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Generic Pipeline Demo - JaiTTS + Thonburian STT</h1>

        <div className="flex gap-4 mb-6">
          <button
            onClick={connect}
            disabled={isConnected}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50 hover:bg-blue-700 transition-colors"
          >
            {isConnected ? 'Connected' : 'Connect'}
          </button>
          <button
            onClick={disconnect}
            disabled={!isConnected}
            className="px-6 py-2 bg-red-600 text-white rounded-lg disabled:opacity-50 hover:bg-red-700 transition-colors"
          >
            Disconnect
          </button>
          <div className="px-4 py-2 bg-gray-100 rounded-lg">
            <span className="text-sm text-gray-600">Status: </span>
            <span className="font-semibold text-gray-800">{chatStatus}</span>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 space-y-4 max-h-96 overflow-y-auto">
          {conversation.map((msg) => (
            <div
              key={msg.id}
              className={`p-3 rounded ${
                msg.role === 'user'
                  ? 'bg-blue-100 ml-8'
                  : 'bg-gray-100 mr-8'
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
              sendMessage(input.value.trim());
              input.value = '';
            }
          }}
          className="mt-6"
        >
          <input
            type="text"
            name="message"
            placeholder="Type a message..."
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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

        <div className="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">
          <h2 className="font-semibold text-green-900 mb-2">Pipeline Status</h2>
          <ul className="text-sm text-green-800 space-y-1">
            <li>✓ STT: ThonburianSTTAdapter (Thai Whisper at localhost:8001)</li>
            <li>✓ LLM: OpenAILLMAdapter (GPT-4o)</li>
            <li>✓ TTS: JaiTTSAdapter (Thai TTS at localhost:8002)</li>
            <li>• VAD: Mock (no real mic input - uses simulated audio)</li>
          </ul>
          <p className="mt-2 text-xs text-green-700">
            <strong>Before connecting:</strong>
            <br />1. Start thonburian-stt: <code>cd ~/thonburian-stt && uvicorn main:app --reload --port 8001</code>
            <br />2. Start jai-tts: <code>cd ~/jai-tts && uvicorn main:app --reload --port 8002</code>
            <br />3. Set env var: <code>NEXT_PUBLIC_OPENAI_API_KEY=your_key_here</code>
          </p>
          <p className="mt-2 text-xs text-yellow-700">
            <strong>Current limitation:</strong> VAD is mocked - no real microphone input. Text messages work, but voice input requires MicVAD integration.
          </p>
        </div>

        <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <h2 className="font-semibold text-blue-900 mb-2">Error Handling</h2>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• If thonburian-stt is down: STT calls fail with connection error</li>
            <li>• If jai-tts is down: TTS calls fail with connection error</li>
            <li>• If API key is missing: LLM calls fail with auth error</li>
          </ul>
          <p className="mt-2 text-xs text-blue-700">
            Check browser console and network tab for detailed error messages.
          </p>
        </div>

        <div className="mt-4 p-4 bg-purple-50 rounded-lg border border-purple-200">
          <h2 className="font-semibold text-purple-900 mb-2">Audio Wire Format</h2>
          <p className="text-sm text-purple-800">
            See <code className="bg-purple-100 px-1">AUDIO_FORMAT.md</code> for exact audio specifications:
          </p>
          <ul className="text-sm text-purple-700 mt-1 space-y-1">
            <li>• STT: 16kHz/mono/float32 WAV (VAD → Thonburian)</li>
            <li>• TTS: 24kHz/mono/int16 WAV (JaiTTS → Browser)</li>
          </ul>
          <p className="mt-2 text-xs text-purple-700">
            Run round-trip test: <code>vitest run src/app/generic-demo/__tests__/roundtrip-audio-contract.test.ts</code>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function GenericDemoPageWrapper() {
  return (
    <KhaveeProvider realtimeProvider={genericProvider}>
      <GenericDemoPage />
    </KhaveeProvider>
  );
}
