'use client';

import { OpenAIRealtimeProvider } from '@khaveeai/providers-openai-realtime';
import { KhaveeProvider, useRealtime } from '@khaveeai/react';

const openaiProvider = new OpenAIRealtimeProvider({
  useProxy: true,
  proxyEndpoint: '/api/negotiate',
  voice: 'shimmer',
  instructions: 'You are a helpful AI assistant. Be conversational and friendly.',
});

function OpenAIChat() {
  const { connect, disconnect, sendMessage, conversation, isConnected } = useRealtime();

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">OpenAI Realtime Voice Chat</h1>
        
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
      </div>
    </div>
  );
}

export default function OpenAI() {
  return (
    <KhaveeProvider config={{ realtime: openaiProvider }}>
      <OpenAIChat />
    </KhaveeProvider>
  );
}
