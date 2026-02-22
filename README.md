# 🎭 Khavee AI - VRM Avatar SDK

**Transform VRM 3D avatars into interactive AI characters with expressions, animations, and voice.**

Build immersive AI experiences with realistic 3D avatars that can talk, express emotions, and respond intelligently to users.

[![NPM Version](https://img.shields.io/npm/v/@khaveeai/react)](https://www.npmjs.com/package/@khaveeai/react)
[![License](https://img.shields.io/npm/l/@khaveeai/react)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue)](https://www.typescriptlang.org/)

---

## ✨ Features

- 🎤 **Real-time Voice Chat** - OpenAI Realtime API with WebRTC (no backend needed)
- 👄 **Automatic Lip Sync** - MFCC-based phoneme detection syncs with AI speech
- 💬 **Talking Animations** - Auto-plays gestures during AI conversations
- 🎨 **Facial Expressions** - Control 30+ VRM expressions with smooth transitions
- 💃 **Body Animations** - Load FBX/GLB animations or full GLB models via simple URLs
- 🔍 **RAG Support** - Built-in vector search with Qdrant for knowledge bases
- 👁️ **Natural Blinking** - Randomized blinking for lifelike avatars
- 🛠️ **Function Calling** - OpenAI tools for custom functions and RAG
- 🎯 **Simple API** - URL-based animations, no complex setup
- 📦 **Provider System** - Plug-and-play OpenAI Realtime, Mock, or custom providers
- 🎭 **Auto-Remapping** - Mixamo animations work out of the box
- 💪 **TypeScript** - Full type safety and IntelliSense support
- ⚡ **React Three Fiber** - Built on the industry-standard 3D React framework

---

## 📦 Installation

### Required Dependencies

First, install the core 3D rendering libraries:

```bash
npm install three @react-three/fiber @react-three/drei
# or
pnpm add three @react-three/fiber @react-three/drei
# or
yarn add three @react-three/fiber @react-three/drei
```

### Install Khavee AI SDK

```bash
npm install @khaveeai/react @khaveeai/core
# or
pnpm add @khaveeai/react @khaveeai/core
# or
yarn add @khaveeai/react @khaveeai/core
```

### Optional: Provider Packages

```bash
# For OpenAI Realtime API (voice chat + lip sync)
npm install @khaveeai/providers-openai-realtime

# For RAG (Retrieval-Augmented Generation)
npm install @khaveeai/providers-rag

# For development/testing (no API keys needed)
npm install @khaveeai/providers-mock
```

### Peer Dependencies

The SDK requires these peer dependencies (most React projects already have them):

```json
{
  "react": "^18.0.0 || ^19.0.0",
  "react-dom": "^18.0.0 || ^19.0.0",
  "three": "^0.160.0"
}
```

---

## 🚀 Quick Start

### Basic VRM Avatar

```tsx
import { Canvas } from '@react-three/fiber';
import { KhaveeProvider, VRMAvatar } from '@khaveeai/react';

export default function App() {
  return (
    <KhaveeProvider>
      <Canvas>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} />
        
        <VRMAvatar 
          src="/models/character.vrm"
          position={[0, -1, 0]}
        />
      </Canvas>
    </KhaveeProvider>
  );
}
```

### With Animations

```tsx
const animations = {
  idle: '/animations/idle.fbx',        // Auto-plays on load (FBX)
  walk: '/animations/walk.glb',        // GLB with animation
  dance: '/animations/dance.fbx',
  talking: '/animations/talking.glb',  // Played during AI speech (GLB)
  gesture1: '/animations/gesture.fbx'  // Also played during speech
};

function App() {
  return (
    <KhaveeProvider>
      <Canvas>
        <VRMAvatar 
          src="/models/character.vrm"
          animations={animations}
          enableBlinking={true}              // Natural blinking
          enableTalkingAnimations={true}     // Gestures during speech
        />
      </Canvas>
    </KhaveeProvider>
  );
}
```

**Note:** Animations with 'talk', 'gesture', or 'speak' in the name are automatically played randomly when the AI is speaking.

### GLB Models with Embedded Animations

For GLB files that contain both model AND animations in one file:

```tsx
import { GLBAvatar, useAnimations } from '@khaveeai/react';

function Controls() {
  const { animate, availableAnimations } = useAnimations();
  
  return (
    <div>
      <h3>Animations ({availableAnimations.length})</h3>
      {availableAnimations.map(name => (
        <button key={name} onClick={() => animate(name)}>
          {name}
        </button>
      ))}
    </div>
  );
}

function App() {
  return (
    <KhaveeProvider>
      <Canvas>
        <GLBAvatar 
          src="/models/dragon.glb"
          autoPlayAnimation="idle"
          position={[0, 0, 0]}
        />
      </Canvas>
      <Controls />
    </KhaveeProvider>
  );
}
```

### With OpenAI Realtime (Voice Chat + Lip Sync)

```tsx
"use client";
import { KhaveeProvider, VRMAvatar, useRealtime } from '@khaveeai/react';
import { OpenAIRealtimeProvider } from '@khaveeai/providers-openai-realtime';
import { Canvas } from '@react-three/fiber';
import { useMemo } from 'react';

function ChatInterface() {
  const { 
    isConnected, 
    connect, 
    disconnect, 
    sendMessage,
    conversation,
    chatStatus 
  } = useRealtime();

  return (
    <div>
      {!isConnected ? (
        <button onClick={connect}>🎤 Start Voice Chat</button>
      ) : (
        <div>
          <div>Status: {chatStatus}</div>
          <button onClick={() => sendMessage('Hello!')}>Say Hello</button>
          <button onClick={disconnect}>Disconnect</button>
          
          {/* Conversation history */}
          {conversation.map((msg, i) => (
            <div key={i}>{msg.role}: {msg.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  // Memoize provider to prevent recreation
  const realtime = useMemo(() => 
    new OpenAIRealtimeProvider({
      apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY!,
      voice: 'coral',
      instructions: 'You are a helpful AI assistant.',
    }), []
  );

  return (
    <KhaveeProvider config={{ realtime }}>  
      <Canvas>
        {/* Lip sync happens automatically! */}
        <VRMAvatar src="/models/character.vrm" />
      </Canvas>
      <ChatInterface />
    </KhaveeProvider>
  );
}
```

**✨ Automatic Features:**
- Lip sync with MFCC phoneme detection
- Talking animations during speech
- Natural blinking
- WebRTC connection (no backend needed)

---

## 🎨 Control Expressions

```tsx
import { useVRMExpressions } from '@khaveeai/react';

function ExpressionControls() {
  const { setExpression, resetExpressions, setMultipleExpressions } = useVRMExpressions();

  return (
    <div>
      {/* Single expression */}
      <button onClick={() => setExpression('happy', 1)}>
        😊 Happy
      </button>
      
      {/* Partial intensity */}
      <button onClick={() => setExpression('happy', 0.5)}>
        🙂 Slightly Happy
      </button>
      
      {/* Multiple expressions */}
      <button onClick={() => setMultipleExpressions({
        happy: 0.8,
        surprised: 0.4
      })}>
        😲 Excited
      </button>
      
      {/* Reset all */}
      <button onClick={() => resetExpressions()}>
        😐 Neutral
      </button>
    </div>
  );
}
```

---

## 💃 Play Animations

```tsx
import { useVRMAnimations } from '@khaveeai/react';

function AnimationControls() {
  const { animate, stopAnimation, currentAnimation } = useVRMAnimations();

  return (
    <div>
      <button onClick={() => animate('walk')}>
        🚶 Walk
      </button>
      <button onClick={() => animate('dance')}>
        💃 Dance
      </button>
      <button onClick={() => animate('idle')}>
        🧍 Idle
      </button>
      <button onClick={() => stopAnimation()}>
        ⏹️ Stop
      </button>
      
      <p>Current: {currentAnimation || 'none'}</p>
    </div>
  );
}
```

---

## 🗂️ Project Structure

```
your-project/
├── public/
│   ├── models/
│   │   └── character.vrm          # Your VRM model
│   └── animations/
│       ├── idle.fbx               # Mixamo animations
│       ├── walk.fbx
│       └── dance.fbx
├── src/
│   ├── app/
│   │   └── page.tsx               # Your main component
│   └── ...
└── package.json
```

---

## 📚 API Reference

### Components

#### `<KhaveeProvider>`

Root provider that manages VRM state and optional LLM/TTS configuration.

```tsx
<KhaveeProvider config={config}>
  {children}
</KhaveeProvider>
```

**Props:**
- `config?` - Optional LLM/TTS provider configuration
- `children` - React children

#### `<VRMAvatar>`

Renders a VRM 3D character with animations and expressions.

```tsx
<VRMAvatar
  src="/models/character.vrm"
  animations={animations}
  position={[0, -1, 0]}
  rotation={[0, Math.PI, 0]}
  scale={[1, 1, 1]}
  enableBlinking={true}
  enableTalkingAnimations={true}
/>
```

**Props:**
- `src` - URL to VRM model file (required)
- `animations?` - Animation configuration (URLs to FBX or GLB files)
- `position?` - 3D position `[x, y, z]` (default: `[0, 0, 0]`)
- `rotation?` - 3D rotation `[x, y, z]` (default: `[0, Math.PI, 0]`)
- `scale?` - 3D scale `[x, y, z]` (default: `[1, 1, 1]`)
- `enableBlinking?` - Enable natural blinking (default: `true`)
- `enableTalkingAnimations?` - Enable gestures during AI speech (default: `true`)

---

### Hooks

#### `useVRMExpressions()`

Control facial expressions with smooth transitions.

```tsx
const { 
  expressions,           // Current expression values
  setExpression,         // Set single expression
  resetExpressions,      // Reset all to neutral
  setMultipleExpressions // Set multiple at once
} = useVRMExpressions();
```

**Example:**
```tsx
setExpression('happy', 1);              // Full happiness
setExpression('happy', 0.5);            // Partial
setMultipleExpressions({                // Multiple
  happy: 0.8,
  surprised: 0.3
});
resetExpressions();                     // Reset all
```

#### `useVRMAnimations()`

Play and control body animations.

```tsx
const { 
  animate,              // Play animation by name
  stopAnimation,        // Stop all animations
  currentAnimation      // Currently playing animation name
} = useVRMAnimations();
```

**Example:**
```tsx
animate('walk');       // Play walk animation
animate('dance');      // Play dance animation
stopAnimation();       // Stop all
```

#### `useRealtime()`

Real-time voice chat with OpenAI Realtime API.

```tsx
const { 
  isConnected,
  connect,
  disconnect,
  sendMessage,
  conversation,
  chatStatus,
  currentPhoneme,  // Current phoneme for lip sync
  interrupt        // Interrupt AI speech
} = useRealtime();

// Usage
await connect();              // Start voice chat
await sendMessage('Hello!');  // Send text message
interrupt();                   // Stop AI from speaking
await disconnect();            // End session
```

**Chat Status Values:**
- `stopped` - Not connected
- `ready` - Connected, waiting
- `listening` - User is speaking
- `thinking` - AI is processing
- `speaking` - AI is responding

#### `useAudioLipSync()`

Analyze audio files for lip sync (separate from realtime).

```tsx
const { 
  analyzeLipSync, 
  stopLipSync, 
  isAnalyzing,
  currentPhoneme 
} = useAudioLipSync();

// Usage
await analyzeLipSync('/audio/speech.wav', {
  sensitivity: 0.8,
  intensityMultiplier: 3.0
});
```

#### `useVRM()`

Access the raw VRM instance for advanced use cases.

```tsx
const vrm = useVRM();

if (vrm) {
  console.log('VRM loaded:', vrm.meta.name);
}
```

#### `useKhavee()`

Access all SDK functionality at once.

```tsx
const { 
  vrm,
  setExpression,
  animate,
  // ... all functions
} = useKhavee();
```

---

## 🎯 Common Patterns

### Real-time Voice Chat with Expressions

```tsx
function VoiceChat() {
  const { isConnected, connect, chatStatus } = useRealtime();
  const { setExpression } = useVRMExpressions();

  // Set expressions based on chat status
  useEffect(() => {
    if (chatStatus === 'listening') {
      setExpression('surprised', 0.3);
    } else if (chatStatus === 'thinking') {
      setExpression('neutral', 1);
    } else if (chatStatus === 'speaking') {
      setExpression('happy', 0.7);
    }
  }, [chatStatus]);

  return (
    <button onClick={connect} disabled={isConnected}>
      🎤 Start Voice Chat
    </button>
  );
}
```

### Animation + Expression Combo

```tsx
function DanceWithJoy() {
  const { animate } = useVRMAnimations();
  const { setExpression } = useVRMExpressions();

  const danceHappily = () => {
    animate('dance');
    setExpression('happy', 1);
  };

  return <button onClick={danceHappily}>Dance!</button>;
}
```

### Text Input with Voice Response

```tsx
function TextChat() {
  const { sendMessage, conversation, chatStatus } = useRealtime();
  const [input, setInput] = useState('');

  const handleSend = async () => {
    if (!input.trim()) return;
    await sendMessage(input);
    setInput('');
  };

  return (
    <div>
      <div className="messages">
        {conversation.map((msg, i) => (
          <div key={i}>
            <strong>{msg.role}:</strong> {msg.text}
          </div>
        ))}
      </div>
      
      <input 
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyPress={(e) => e.key === 'Enter' && handleSend()}
        disabled={chatStatus === 'speaking'}
      />
      <button onClick={handleSend}>Send</button>
    </div>
  );
}
```

---

## 🔌 Providers

### OpenAI Realtime Provider (Recommended)

Real-time voice chat with automatic lip sync:

```tsx
import { OpenAIRealtimeProvider } from '@khaveeai/providers-openai-realtime';
import { useMemo } from 'react';

function App() {
  const realtime = useMemo(() => 
    new OpenAIRealtimeProvider({
      apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY!,
      voice: 'coral',  // or: alloy, echo, sage, shimmer
      instructions: 'You are a helpful AI assistant.',
      temperature: 0.8,
      tools: []  // Optional: Add RAG or custom functions
    }), []
  );

  return (
    <KhaveeProvider config={{ realtime }}>  
      {/* Your app */}
    </KhaveeProvider>
  );
}
```

### RAG Provider

Add knowledge base search to your AI:

```tsx
// app/lib/rag.ts (server-side)
"use server";
import { RAGProvider } from '@khaveeai/providers-rag';

export async function searchKnowledgeBase(query: string) {
  const rag = new RAGProvider({
    qdrantUrl: process.env.QDRANT_URL!,
    qdrantApiKey: process.env.QDRANT_API_KEY,
    collectionName: process.env.QDRANT_COLLECTION!,
    openaiApiKey: process.env.OPENAI_API_KEY!,
  });
  return await rag.search(query);
}

// app/page.tsx (client-side)
"use client";
const realtime = new OpenAIRealtimeProvider({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY!,
  tools: [
    {
      name: 'search_knowledge_base',
      description: 'Search the knowledge base',
      parameters: {
        query: { type: 'string', description: 'Search query', required: true }
      },
      execute: async (args) => await searchKnowledgeBase(args.query)
    }
  ]
});
```

### Mock Provider (Development)

Perfect for testing without API keys:

```tsx
import { MockLLM, MockTTS } from '@khaveeai/providers-mock';

const config = {
  llm: new MockLLM(),
  tts: new MockTTS(),
};

<KhaveeProvider config={config}>
  {/* Test your UI without API costs */}
</KhaveeProvider>
```

---

## 🎨 Where to Get Assets

### VRM Models
- [VRoid Hub](https://hub.vroid.com/) - Free VRM characters
- [VRoid Studio](https://vroid.com/en/studio) - Create your own
- [Booth.pm](https://booth.pm/) - Buy premium models

### Mixamo Animations
1. Go to [Mixamo](https://www.mixamo.com/)
2. Select any animation
3. Download as **FBX** format
4. No skeleton, just animation
5. Use the URL in your `animations` config

**Recommended Animations:**
- Idle → Breathing Idle
- Walk → Walking
- Dance → Hip Hop Dancing, Swing Dancing
- Talk → Talking with Hands
- Wave → Waving

---

## 🛠️ Troubleshooting

### VRM not rendering?

**Check these:**
1. ✅ VRM file is valid (test in [VRoid Hub](https://hub.vroid.com/))
2. ✅ Wrapped in `<Canvas>` from `@react-three/fiber`
3. ✅ Wrapped in `<KhaveeProvider>`
4. ✅ Lights added to scene (`<ambientLight>`, `<directionalLight>`)

### Animations not playing?

**Check these:**
1. ✅ FBX files are from Mixamo
2. ✅ Downloaded as **FBX** (not BVH)
3. ✅ "Without Skin" option selected
4. ✅ URLs are correct and accessible
5. ✅ Animation name matches config key

### Expressions not working?

**Check these:**
1. ✅ VRM model has expression support
2. ✅ Expression names are correct (check VRM in VRoid Hub)
3. ✅ Values between 0 and 1
4. ✅ Called inside component wrapped by `<KhaveeProvider>`

### LLM/Voice not working?

**Check these:**
1. ✅ Provider configured in `<KhaveeProvider config={...}>`
2. ✅ API keys are valid

---

## 📖 Full Documentation

- [API Reference](./docs/API_REFERENCE.md) - Complete API docs
- [Examples](./src/app/khavee-example/) - Working examples
- [Function Documentation](./COMPLETE_FUNCTION_DOCS.md) - All functions documented
- [IntelliSense Guide](./INTELLISENSE_PREVIEW.md) - IDE integration guide

---

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

---

## 📄 License

MIT © [Khavee AI](https://github.com/SolveServeSolution/khaveeai-sdk)

---

## 🌟 Examples

Check out our [example app](./src/app/khavee-example/) to see:
- ✅ Expression controls
- ✅ Animation panel
- ✅ LLM chat integration
- ✅ Voice synthesis
- ✅ Combined interactions

---

## 💬 Support

- 📧 Email: support@khaveeai.com
- 💬 Discord: [Join our community](https://discord.gg/khaveeai)
- 🐛 Issues: [GitHub Issues](https://github.com/SolveServeSolution/khaveeai-sdk/issues)

---

**Built with ❤️ by the Khavee AI Team**
