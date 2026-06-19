'use client';

import { GenericPipelineProvider, OpenAILLMAdapter } from '@khaveeai/providers-generic-stt-tts';
import { KhaveeProvider, useRealtime } from '@khaveeai/react';
import { VADProvider } from '@khaveeai/core';
import { ThonburianSTTAdapter } from './adapters/ThonburianSTTAdapter';
import { JaiTTSAdapter } from './adapters/JaiTTSAdapter';

// Simple mock VAD for testing
class SimpleMockVAD implements VADProvider {
  readonly name = 'mock-vad';
  private listening = false;

  async connect() {
    this.listening = true;
    console.log('[MockVAD] connected');
  }

  async disconnect() {
    this.listening = false;
    console.log('[MockVAD] disconnected');
  }

  async pause() {
    console.log('[MockVAD] paused');
  }

  async resume() {
    console.log('[MockVAD] resumed');
  }

  isListening() {
    return this.listening;
  }
}

// Create pipeline providers
const vad = new SimpleMockVAD();
const stt = new ThonburianSTTAdapter();
const llm = new OpenAILLMAdapter({
  endpoint: 'https://api.openai.com/v1/chat/completions',
  authToken: process.env.NEXT_PUBLIC_OPENAI_API_KEY || '',
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
        <h1 className="text-3xl font-bold mb-6">Generic Pipeline Demo</h1>

        <div className="flex gap-4 mb-6">
          <button onClick={connect} disabled={isConnected} className="px-6 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">
            {isConnected ? 'Connected' : 'Connect'}
          </button>
          <button onClick={disconnect} disabled={!isConnected} className="px-6 py-2 bg-red-600 text-white rounded-lg disabled:opacity-50">
            Disconnect
          </button>
          <div className="px-4 py-2 bg-gray-100 rounded-lg">
            Status: {chatStatus}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 space-y-4 max-h-96 overflow-y-auto">
          {conversation.map((msg) => (
            <div key={msg.id} className={`p-3 rounded ${msg.role === 'user' ? 'bg-blue-100 ml-8' : 'bg-gray-100 mr-8'}`}>
              <div className="font-semibold text-sm mb-1">{msg.role === 'user' ? 'You' : 'AI'}</div>
              <div>{msg.text}</div>
            </div>
          ))}
        </div>

        <form onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem('message') as HTMLInputElement;
          if (input.value.trim()) {
            sendMessage(input.value.trim());
            input.value = '';
          }
        }} className="mt-6">
          <input type="text" name="message" placeholder="Type a message..." className="w-full px-4 py-2 border border-gray-300 rounded-lg" disabled={!isConnected} />
          <button type="submit" disabled={!isConnected} className="mt-2 w-full px-4 py-2 bg-green-600 text-white rounded-lg disabled:opacity-50">
            Send Message
          </button>
        </form>

        <div className="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">
          <h2 className="font-semibold text-green-900 mb-2">Status</h2>
          <ul className="text-sm text-green-800 space-y-1">
            <li>✓ STT: ThonburianSTTAdapter (localhost:8001)</li>
            <li>✓ LLM: OpenAILLMAdapter (GPT-4o)</li>
            <li>✓ TTS: JaiTTSAdapter (localhost:8002)</li>
            <li>• VAD: SimpleMockVAD (no real mic)</li>
          </ul>
          <p className="mt-2 text-xs text-green-700">
            Set NEXT_PUBLIC_OPENAI_API_KEY and start both services before connecting.
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
