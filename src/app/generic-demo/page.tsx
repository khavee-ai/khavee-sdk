'use client';

import { GenericPipelineProvider, OpenAILLMAdapter, OpenAIVADAdapter } from '@khaveeai/providers-generic-stt-tts';
import { KhaveeProvider, useRealtime } from '@khaveeai/react';
import { ThonburianSTTAdapter } from './adapters/ThonburianSTTAdapter';
import { JaiTTSAdapter } from './adapters/JaiTTSAdapter';

// Create pipeline providers
const vad = new OpenAIVADAdapter();
const stt = new ThonburianSTTAdapter();
const llm = new OpenAILLMAdapter({
  endpoint: '/api/generic-chat-proxy',
  authToken: 'local-dev', // proxy reads the real key from server-side OPENAI_API_KEY
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
