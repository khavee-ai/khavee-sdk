import OpenAI from 'openai';
import { LegacyLLMProvider } from '@khaveeai/core';

export interface LLMOpenAIConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
  mock?: boolean; // Enable mock mode for development
}

export class LLMOpenAI implements LegacyLLMProvider {
  private client?: OpenAI;
  private model: string;
  private mock: boolean;

  constructor(config: LLMOpenAIConfig) {
    this.mock = config.mock || false;
    
    if (!this.mock) {
      this.client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      });
    }
    
    this.model = config.model || 'gpt-4';
  }

  async *streamChat({ messages }: { messages: { role: string; content: string }[] }) {
    if (this.mock) {
      // Mock streaming response
      const mockResponses = [
        "Hello! I'm a VRM avatar powered by AI. ",
        "I can understand your questions and respond with appropriate animations. ",
        "Feel free to ask me anything, and I'll try to express myself through movement and voice! ",
        "🎭 *waves cheerfully*"
      ];
      
      const lastMessage = messages[messages.length - 1]?.content.toLowerCase() || '';
      
      let response = '';
      if (lastMessage.includes('dance') || lastMessage.includes('move')) {
        response = "I'd love to dance! Let me show you some moves! *trigger_animation: swing_dance* 💃";
      } else if (lastMessage.includes('hello') || lastMessage.includes('hi')) {
        response = "Hello there! Nice to meet you! *trigger_animation: wave_small* 👋";
      } else if (lastMessage.includes('sad') || lastMessage.includes('cry')) {
        response = "I understand you're feeling down. *trigger_animation: sad* Let me know if you need support. 💙";
      } else if (lastMessage.includes('happy') || lastMessage.includes('good')) {
        response = "That's wonderful! I'm so happy to hear that! *trigger_animation: laugh* 😊";
      } else {
        response = mockResponses[Math.floor(Math.random() * mockResponses.length)];
      }
      
      // Simulate streaming by yielding character by character with delays
      for (let i = 0; i < response.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 50));
        yield { type: 'text', delta: response[i] };
      }
      return;
    }

    if (!this.client) {
      throw new Error('OpenAI client not initialized. Set mock: false or provide valid apiKey.');
    }

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: messages as any,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield { type: 'text', delta };
      }
    }
  }
}