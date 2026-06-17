import { LegacyLLMProvider, LegacyTTSProvider } from '@khaveeai/core';

export class MockLLM implements LegacyLLMProvider {
  private responses: string[];

  constructor() {
    this.responses = [
      "Hello! I'm a VRM avatar powered by AI. I can understand your questions and respond with appropriate animations.",
      "That's interesting! Let me think about that for a moment... *trigger_animation: thinking*",
      "I'd love to help you with that! *trigger_animation: wave_small* 👋",
      "Great question! *trigger_animation: nod_yes* I'll do my best to give you a helpful answer.",
      "I'm feeling happy today! *trigger_animation: smile_soft* How can I assist you?",
      "Wow, that sounds exciting! *trigger_animation: surprised* Tell me more!",
      "I understand how you feel. *trigger_animation: sad* Sometimes things can be challenging.",
      "Let's dance! *trigger_animation: swing_dance* 💃 Music makes everything better!",
    ];
  }

  async *streamChat({ messages }: { messages: { role: string; content: string }[] }) {
    const lastMessage = messages[messages.length - 1]?.content.toLowerCase() || '';
    
    let response = '';
    
    // Context-aware responses
    if (lastMessage.includes('dance') || lastMessage.includes('move')) {
      response = "I'd love to dance! Let me show you some moves! *trigger_animation: swing_dance* 💃";
    } else if (lastMessage.includes('hello') || lastMessage.includes('hi') || lastMessage.includes('hey')) {
      response = "Hello there! Nice to meet you! *trigger_animation: wave_small* 👋";
    } else if (lastMessage.includes('sad') || lastMessage.includes('cry') || lastMessage.includes('upset')) {
      response = "I understand you're feeling down. *trigger_animation: sad* Let me know if you need support. 💙";
    } else if (lastMessage.includes('happy') || lastMessage.includes('good') || lastMessage.includes('great')) {
      response = "That's wonderful! I'm so happy to hear that! *trigger_animation: laugh* 😊";
    } else if (lastMessage.includes('fight') || lastMessage.includes('angry') || lastMessage.includes('mad')) {
      response = "Whoa there! Let's keep things peaceful. *trigger_animation: punch* But I can show you some moves if you want!";
    } else if (lastMessage.includes('think') || lastMessage.includes('question') || lastMessage.includes('wonder')) {
      response = "Let me think about that... *trigger_animation: thinking* 🤔 That's a really thoughtful question!";
    } else if (lastMessage.includes('yes') || lastMessage.includes('agree') || lastMessage.includes('correct')) {
      response = "Yes, exactly! *trigger_animation: nod_yes* I'm glad we're on the same page!";
    } else if (lastMessage.includes('no') || lastMessage.includes('disagree') || lastMessage.includes('wrong')) {
      response = "I don't think so... *trigger_animation: shake_no* Let me explain my perspective.";
    } else {
      // Random response
      response = this.responses[Math.floor(Math.random() * this.responses.length)];
    }
    
    // Simulate realistic typing speed
    for (let i = 0; i < response.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 60));
      yield { type: 'text', delta: response[i] };
    }
  }
}

export class MockTTS implements LegacyTTSProvider {
  async speak({ text, voice = 'mock-voice' }: { text: string; voice?: string }): Promise<void> {
    console.log(`🔊 [Mock TTS] Speaking with ${voice}:`);
    console.log(`"${text}"`);
    
    // Simulate speech duration (roughly 150 words per minute)
    const words = text.split(' ').length;
    const durationMs = Math.min((words / 150) * 60 * 1000, 8000); // Cap at 8 seconds
    
    // Simulate viseme data for lip sync
    this.simulateVisemes(text);
    
    console.log(`⏱️  [Mock TTS] Speech duration: ${Math.round(durationMs)}ms`);
    
    await new Promise(resolve => setTimeout(resolve, durationMs));
    
    console.log('✅ [Mock TTS] Speech completed');
  }

  private simulateVisemes(text: string) {
    // Mock viseme mapping for realistic lip-sync simulation
    const visemeMap: Record<string, string> = {
      'a': 'aa', 'e': 'ee', 'i': 'ih', 'o': 'oh', 'u': 'ou',
      'b': 'PP', 'm': 'PP', 'p': 'PP',
      'f': 'FF', 'v': 'FF',
      't': 'TH', 'd': 'TH', 'n': 'TH', 'l': 'TH',
      's': 'SS', 'z': 'SS', 'sh': 'CH', 'ch': 'CH',
      'r': 'RR', 'w': 'kk', 'y': 'ih'
    };
    
    console.log('👄 [Mock Visemes] Simulating lip-sync patterns...');
    
    // This would typically emit real-time viseme events
    // For development, we just log the simulation
    const vowels = text.toLowerCase().match(/[aeiou]/g) || [];
    const consonants = text.toLowerCase().match(/[bcdfghjklmnpqrstvwxyz]/g) || [];
    
    console.log(`   📊 Detected: ${vowels.length} vowels, ${consonants.length} consonants`);
    console.log(`   🎭 Viseme sequence: ${text.substring(0, 30)}${text.length > 30 ? '...' : ''}`);
  }
}