'use client';

import { GenericPipelineProvider } from '@khaveeai/providers/generic-stt-tts';
import { KhaveeProvider, useRealtime } from '@khaveeai/react';
import { VADProvider, LLMProvider, TTSProvider } from '@khaveeai/core';
import { ThonburianSTTAdapter } from './adapters/ThonburianSTTAdapter';

// ── Mock adapters for initial scaffold ─────────────────────────────────────

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

// STT is now the real Thonburian adapter (04-01 Task 3)
// LLM and TTS remain mocks until 04-02
const stt = new ThonburianSTTAdapter();

class MockLLMProvider implements LLMProvider {
  readonly name = 'mock-llm';
  readonly supportsToolCalling = false;
  readonly supportsStreaming = false;

  async complete(args: { messages: { role: string; content: string }[] }): Promise<{
    text: string;
    toolCalls?: { id: string; name: string; args: Record<string, any> }[];
  }> {
    const lastUserMessage = args.messages.filter(m => m.role === 'user').pop();
    console.log('[MockLLM] completing with messages:', args.messages.length);
    return {
      text: `[Mock LLM response to: "${lastUserMessage?.content || 'empty'}" - will be replaced with real LLM]`,
    };
  }
}

class MockTTSProvider implements TTSProvider {
  readonly name = 'mock-tts';
  readonly supportsStreaming = false;

  async speak(text: string, audioContext: AudioContext, opts?: { voice?: string; speed?: number; signal?: AbortSignal }): Promise<void> {
    console.log('[MockTTS] speaking:', text);
    // Create a simple beep for mock audio
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.frequency.value = 440;
    gainNode.gain.value = 0.1;
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.1);
  }
}

// ── Demo page component ─────────────────────────────────────────────────────

const vad = new MockVADProvider();
const stt = new MockSTTProvider();
const llm = new MockLLMProvider();
const tts = new MockTTSProvider();

const genericProvider = new GenericPipelineProvider({
  vad,
  stt,
  llm,
  tts,
  micReopenCooldownMs: 500,
});

function GenericDemoPage() {
  const { connect, disconnect, sendMessage, conversation, isConnected } = useRealtime();

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Generic Pipeline Demo - JaiTTS + Thonburian STT</h1>

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
          <h2 className="font-semibold text-green-900 mb-2">Current Status</h2>
          <ul className="text-sm text-green-800 space-y-1">
            <li>✓ STT: ThonburianSTTAdapter (real Thai Whisper at localhost:8001)</li>
            <li>• LLM: Mock (will be OpenAILLMAdapter in 04-02)</li>
            <li>• TTS: Mock (will be JaiTTSAdapter in 04-02)</li>
          </ul>
          <p className="mt-2 text-xs text-green-700">
            Make sure thonburian-stt service is running at localhost:8001 for STT to work.
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
