# @khaveeai/react

🎭 **React components and hooks for intelligent VRM AI avatars with advanced animation and lip synchronization.**

[![npm version](https://badge.fury.io/js/%40khaveeai%2Freact.svg)](https://badge.fury.io/js/%40khaveeai%2Freact)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- 🤖 **Smart VRM Avatars** - 3D character rendering with Three.js/R3F
- 🎤 **Real-time Voice Chat** - OpenAI Realtime API integration with WebRTC
- 👄 **Automatic Lip Sync** - MFCC-based phoneme detection works automatically with OpenAI Realtime
- 💬 **Talking Animations** - Automatic gesture animations during AI speech
- 🎬 **Animation System** - FBX/GLB animation loading with automatic Mixamo remapping
- 😊 **Facial Expressions** - Smooth VRM expression control with transitions
- 👁️ **Natural Blinking** - Randomized blinking animations for lifelike characters
- 🔊 **Audio Lip Sync** - File-based lip sync analysis with MFCC and DTW algorithms
- 🛠️ **Function Calling** - OpenAI tool integration for RAG and custom functions
- ⚡ **High Performance** - Optimized rendering with automatic cleanup

## Installation

```bash
# Core SDK
npm install @khaveeai/react @khaveeai/core

# Peer dependencies
npm install react @react-three/fiber @react-three/drei

# Optional: Provider packages for LLM/TTS/Realtime features
npm install @khaveeai/providers-mock             # Development/testing
npm install @khaveeai/providers-openai           # OpenAI LLM/TTS
npm install @khaveeai/providers-openai-realtime  # OpenAI Realtime API
npm install @khaveeai/providers-azure            # Azure Cognitive Services
```

## Quick Start

### Basic VRM Avatar

```tsx
import { Canvas } from '@react-three/fiber';
import { KhaveeProvider, VRMAvatar } from '@khaveeai/react';

function App() {
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

### GLB Models with Embedded Animations

Use `GLBAvatar` for GLB files that contain both the model AND animations in one file:

```tsx
import { Canvas } from '@react-three/fiber';
import { KhaveeProvider, GLBAvatar, useAnimations } from '@khaveeai/react';

function Controls() {
  const { animate } = useAnimations();
  
  return (
    <>
      <button onClick={() => animate('idle')}>Idle</button>
      <button onClick={() => animate('walk')}>Walk</button>
      <button onClick={() => animate('run')}>Run</button>
    </>
  );
}

function App() {
  return (
    <KhaveeProvider>
      <Canvas>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} />
        
        <GLBAvatar 
          src="/models/dragon.glb"    // GLB with model + animations
          autoPlayAnimation="idle"     // or use index: 0, 1, 2
          position={[0, 0, 0]}
        />
      </Canvas>
      <Controls />
    </KhaveeProvider>
  );
}
```

### Animation System (Separate Files)

```tsx
import { VRMAvatar, useVRMAnimations } from '@khaveeai/react';

function AnimatedAvatar() {
  const { animate } = useVRMAnimations();
  
  // Define animations (supports both FBX and GLB!)
  const animations = {
    idle: '/animations/idle.fbx',           // Auto-plays (FBX)
    dance: '/animations/dance.glb',         // GLB with embedded animation
    wave: '/animations/wave.fbx'
  };
  
  return (
    <>
      <VRMAvatar 
        src="/models/character.vrm"
        animations={animations}  // SDK handles everything!
      />
      
      <button onClick={() => animate('dance')}>💃 Dance</button>
      <button onClick={() => animate('wave')}>👋 Wave</button>
    </>
  );
}
```

### Facial Expressions

```tsx
import { VRMAvatar, useVRMExpressions } from '@khaveeai/react';

function ExpressiveAvatar() {
  const { setExpression } = useVRMExpressions();
  
  return (
    <>
      <VRMAvatar src="/models/character.vrm" />
      
      <button onClick={() => setExpression('happy', 1)}>😊 Happy</button>
      <button onClick={() => setExpression('sad', 1)}>😢 Sad</button>
    </>
  );
}
```

### Audio-Based Lip Sync

```tsx
import { useAudioLipSync } from '@khaveeai/react';

function LipSyncDemo() {
  const { analyzeLipSync, stopLipSync, isAnalyzing, currentPhoneme } = useAudioLipSync();
  
  return (
    <div>
      <button 
        onClick={() => analyzeLipSync('/audio/speech.wav', {
          sensitivity: 0.8,
          intensityMultiplier: 3.0
        })}
        disabled={isAnalyzing}
      >
        {isAnalyzing ? 'Analyzing...' : 'Start Lip Sync'}
      </button>
      
      <button onClick={stopLipSync}>Stop</button>
      
      {currentPhoneme && (
        <div>
          <p>Phoneme: {currentPhoneme.phoneme}</p>
          <p>Intensity: {(currentPhoneme.intensity * 100).toFixed(1)}%</p>
        </div>
      )}
    </div>
  );
}
```

## API Reference

### Components

#### `<KhaveeProvider>`

Root provider that manages VRM state and optional provider configuration.

```tsx
interface KhaveeConfig {
  llm?: LLMProvider;           // Optional: Chat AI provider
  tts?: TTSProvider;           // Optional: Text-to-speech provider  
  realtime?: RealtimeProvider; // Optional: Real-time voice chat provider
  tools?: RealtimeTool[];      // Optional: Custom functions
}

<KhaveeProvider config={khaveeConfig}>  {/* config is optional */}
  {children}
</KhaveeProvider>
```

#### `<VRMAvatar>`

3D VRM character component with automatic animation, lip sync, and talking animations.

```tsx
interface VRMAvatarProps {
  src: string;                    // Path to .vrm file
  position?: [number, number, number];
  rotation?: [number, number, number];  
  scale?: [number, number, number];
  animations?: AnimationConfig;   // FBX or GLB animation URLs
  enableBlinking?: boolean;       // Enable natural blinking (default: true)
  enableTalkingAnimations?: boolean; // Enable gestures during AI speech (default: true)
}
```

**Animation Config:**
```tsx
interface AnimationConfig {
  [name: string]: string;  // Animation name -> FBX or GLB file URL
}

// Example - Mix FBX and GLB formats!
const animations = {
  idle: '/animations/breathing.fbx',     // Auto-plays on load (FBX)
  walk: '/animations/walking.glb',       // GLB file with animation
  dance: '/animations/dancing.fbx',
  talking: '/animations/talking.glb',    // Played during AI speech (GLB)
  gesture1: '/animations/gesture.fbx'    // Also played during speech
};
// Note: Animations with 'talk', 'gesture', or 'speak' in the name
// are automatically played randomly when chatStatus === 'speaking'
```

**Supported Animation Formats:**
- **FBX** - Automatically remaps Mixamo bone names to VRM bones
- **GLB/GLTF** - Uses embedded animations directly
  - If GLB contains Mixamo animation (name includes "mixamo"), it will be remapped
  - Otherwise, animations are used as-is (supports VRM-compatible or generic animations)
  - If multiple animations exist in one GLB, they are all loaded with indexed names

#### `<GLBAvatar>`

Component for GLB/GLTF models that contain both the 3D model and animations in a single file.

```tsx
interface GLBAvatarProps {
  src: string;                    // Path to .glb or .gltf file
  position?: [number, number, number];
  rotation?: [number, number, number];  
  scale?: [number, number, number];
  autoPlayAnimation?: string | number;  // Animation name or index to auto-play
}
```

**Example:**
```tsx
// GLB file with embedded animations (like dragon.glb from your example)
<GLBAvatar 
  src="/models/character.glb"
  autoPlayAnimation="idle"  // or use index: 0, 1, 2
  position={[0, 0, 0]}
/>
```

**Use Cases:**
- Models exported from Blender with animations
- Downloaded models with embedded animations
- Generic GLB models (not VRM-specific)
- When you don't need VRM expressions/blinking

**Control animations:**
```tsx
const { animate } = useAnimations();

// Switch between animations in the GLB
<button onClick={() => animate('walk')}>Walk</button>
<button onClick={() => animate('run')}>Run</button>
```


### Hooks

**Note:** For animation control, use `useAnimations()` - it works with both `VRMAvatar` and `GLBAvatar`. The `useVRMAnimations()` hook is deprecated but still available for backward compatibility.

#### `useRealtime()`

Real-time voice chat with OpenAI Realtime API.

```tsx
const {
  // Connection
  isConnected: boolean,
  connect: () => Promise<void>,
  disconnect: () => Promise<void>,
  
  // Chat state  
  chatStatus: 'stopped' | 'ready' | 'listening' | 'speaking' | 'thinking',
  conversation: Conversation[],
  currentVolume: number,
  isThinking: boolean,
  
  // Lip sync (automatic with VRMAvatar)
  currentPhoneme: PhonemeData | null,
  startAutoLipSync: () => Promise<void>,
  stopAutoLipSync: () => void,
  
  // Actions
  sendMessage: (text: string) => Promise<void>,
  interrupt: () => void,
  registerFunction: (tool: RealtimeTool) => void
} = useRealtime();
```

#### `useAudioLipSync()`

Analyze audio files for phoneme detection and lip sync.

```tsx
const {
  analyzeLipSync: (audioUrl: string, options?: {
    sensitivity?: number;         // 0.1 to 1.0
    smoothing?: number;          // 0.1 to 1.0  
    intensityMultiplier?: number; // 1.0 to 5.0
    minIntensity?: number;       // 0.0 to 1.0
    onPhonemeChange?: (phoneme: PhonemeData) => void;
  }) => Promise<void>,
  stopLipSync: () => void,
  isAnalyzing: boolean,
  mouthState: MouthState,        // Current mouth state
  currentPhoneme: PhonemeData | null,
  audioElement: HTMLAudioElement | null
} = useAudioLipSync();
```

#### `useVRMExpressions()`

Control VRM facial expressions with smooth transitions.

```tsx
const {
  expressions: Record<string, number>,
  setExpression: (name: string, value: number) => void,
  resetExpressions: () => void,
  setMultipleExpressions: (expressions: Record<string, number>) => void
} = useVRMExpressions();
```

#### `useAnimations()`

Control animations for VRM or GLB models with smooth transitions.

```tsx
const {
  currentAnimation: string | null,
  animate: (name: string) => void,       // Play animation by name
  stopAnimation: () => void,             // Stop current animation
  availableAnimations: string[]          // List of loaded animations
} = useAnimations();
```

#### `useVRMAnimations()`

⚠️ **Deprecated:** Use `useAnimations()` instead.

Alias for `useAnimations()` - kept for backward compatibility.

```tsx
const {
  currentAnimation: string | null,
  animate: (name: string) => void,
  stopAnimation: () => void,
  availableAnimations: string[]
} = useVRMAnimations();
```

#### `useVRM()`

Access the raw VRM model instance.

```tsx
const vrm: VRM | null = useVRM();
```

#### `useKhavee()`

Access the complete SDK context (advanced usage).

```tsx
const {
  config,              // Optional provider config
  vrm,                // VRM instance
  setVrm,             // Set VRM instance
  expressions,        // Current expressions
  setExpression,      // Set single expression
  resetExpressions,   // Reset all expressions
  setMultipleExpressions, // Set multiple expressions
  currentAnimation,   // Current animation name
  animate,           // Play animation
  stopAnimation,     // Stop animation
  availableAnimations, // Available animations
  realtimeProvider   // Realtime provider instance
} = useKhavee();
```

## Advanced Usage

### Automatic Lip Sync with OpenAI Realtime

When using `VRMAvatar` with `OpenAIRealtimeProvider`, lip sync happens automatically! The avatar's mouth movements are synchronized with the AI's speech using MFCC-based phoneme detection:

```tsx
import { KhaveeProvider, VRMAvatar } from '@khaveeai/react';
import { OpenAIRealtimeProvider } from '@khaveeai/providers-openai-realtime';

const realtime = new OpenAIRealtimeProvider({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY!,
  voice: 'coral',
});

function App() {
  return (
    <KhaveeProvider config={{ realtime }}>  
      <Canvas>
        {/* Lip sync happens automatically when AI speaks! */}
        <VRMAvatar 
          src="/models/avatar.vrm"
          enableBlinking={true}              // Natural blinking
          enableTalkingAnimations={true}     // Gestures during speech
        />
      </Canvas>
    </KhaveeProvider>
  );
}
```

The system automatically:
- ✅ Analyzes AI voice audio in real-time
- ✅ Detects phonemes (aa, ee, ih, ou, oh)
- ✅ Applies mouth shapes to VRM expressions
- ✅ Plays talking/gesture animations randomly
- ✅ Resets mouth to neutral when AI stops speaking

### Audio File Lip Sync

For pre-recorded audio files, use the `useAudioLipSync` hook with advanced MFCC (Mel-Frequency Cepstral Coefficients) analysis and Dynamic Time Warping:

```tsx
import { useAudioLipSync } from '@khaveeai/react';

function AdvancedLipSync() {
  const { analyzeLipSync, currentPhoneme, mouthState } = useAudioLipSync();
  
  const startAnalysis = () => {
    analyzeLipSync('/audio/speech.wav', {
      sensitivity: 0.8,           // Higher = more sensitive
      intensityMultiplier: 3.0,   // Boost mouth movement
      minIntensity: 0.3,          // Minimum threshold
      onPhonemeChange: (phoneme) => {
        console.log('Detected:', phoneme.phoneme, phoneme.intensity);
      }
    });
  };
  
  return (
    <div>
      <button onClick={startAnalysis}>Analyze Audio</button>
      
      {/* Real-time mouth state display */}
      <div>
        <h3>Mouth State:</h3>
        {Object.entries(mouthState || {}).map(([viseme, value]) => (
          <div key={viseme}>
            {viseme}: {(value * 100).toFixed(1)}%
            <div style={{ 
              width: `${value * 100}%`, 
              height: '20px', 
              backgroundColor: '#3b82f6' 
            }} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Custom Expression Presets

```tsx
import { useVRMExpressions } from '@khaveeai/react';

function EmotionalPresets() {
  const { setMultipleExpressions, resetExpressions } = useVRMExpressions();
  
  const emotions = {
    happy: { happy: 0.9, relaxed: 0.3 },
    sad: { sad: 0.8, relaxed: 0.2 },
    surprised: { surprised: 0.9, aa: 0.4 },
    confused: { confused: 0.7, worried: 0.3 },
    excited: { happy: 0.8, surprised: 0.6 },
  };
  
  return (
    <div>
      {Object.entries(emotions).map(([name, expression]) => (
        <button 
          key={name}
          onClick={() => setMultipleExpressions(expression)}
        >
          {name}
        </button>
      ))}
      <button onClick={resetExpressions}>Reset</button>
    </div>
  );
}
```

### GLB Animation Discovery

Automatically list and play all animations from a GLB file:

```tsx
import { GLBAvatar, useAnimations } from '@khaveeai/react';
import { Canvas } from '@react-three/fiber';

function AnimationList() {
  const { animate, currentAnimation, availableAnimations } = useAnimations();
  
  return (
    <div>
      <h3>Available Animations ({availableAnimations.length})</h3>
      <p>Current: {currentAnimation || 'None'}</p>
      
      {availableAnimations.length > 0 ? (
        <div>
          {availableAnimations.map((animName) => (
            <button
              key={animName}
              onClick={() => animate(animName)}
              style={{
                fontWeight: currentAnimation === animName ? 'bold' : 'normal',
                background: currentAnimation === animName ? '#4CAF50' : '#2196F3'
              }}
            >
              {currentAnimation === animName ? '▶ ' : ''}{animName}
            </button>
          ))}
        </div>
      ) : (
        <p>Loading animations...</p>
      )}
    </div>
  );
}

function App() {
  return (
    <KhaveeProvider>
      <Canvas>
        <GLBAvatar src="/models/character.glb" />
      </Canvas>
      <AnimationList />
    </KhaveeProvider>
  );
}
```

### Animation Sequences

```tsx
import { useVRMAnimations } from '@khaveeai/react';

function AnimationSequence() {
  const { animate, currentAnimation } = useVRMAnimations();
  
  const playSequence = async () => {
    animate('walk');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    animate('dance');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    animate('idle');
  };
  
  return (
    <div>
      <p>Current: {currentAnimation}</p>
      <button onClick={playSequence}>Play Sequence</button>
    </div>
  );
}
```

## Providers

### OpenAI Realtime Provider

```tsx
import { OpenAIRealtimeProvider } from '@khaveeai/providers-openai-realtime';

const provider = new OpenAIRealtimeProvider({
  apiKey: string,                    // OpenAI API key (required)
  model?: string,                    // Model name (default: 'gpt-4o-realtime-preview-2025-06-03')
  voice?: 'alloy' | 'coral' | 'echo' | 'sage' | 'shimmer', // Voice selection
  instructions?: string,             // System prompt
  temperature?: number,              // Response randomness (0-1)
  tools?: RealtimeTool[],           // Custom functions for RAG, etc.
  language?: string,                // Response language code
  turnServers?: RTCIceServer[]      // Custom TURN servers for WebRTC
});

// Lip sync is automatic when used with VRMAvatar!
```

### Mock Providers (Development)

```tsx
import { MockLLM, MockTTS } from '@khaveeai/providers-mock';

const mockConfig = {
  llm: new MockLLM(),     // Simulated AI responses
  tts: new MockTTS(),     // Simulated voice synthesis
  tools: []
};
```

## Examples

### Complete VRM Character App

```tsx
import React from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { 
  KhaveeProvider, 
  VRMAvatar, 
  useRealtime,
  useAudioLipSync,
  useVRMExpressions,
  useVRMAnimations
} from '@khaveeai/react';
import { OpenAIRealtimeProvider } from '@khaveeai/providers-openai-realtime';

const realtimeProvider = new OpenAIRealtimeProvider({
  apiKey: process.env.REACT_APP_OPENAI_API_KEY,
  voice: 'shimmer',
  instructions: 'You are a friendly AI assistant.',
});

function ControlPanel() {
  const { isConnected, connect, disconnect, conversation } = useRealtime();
  const { analyzeLipSync, stopLipSync, isAnalyzing, currentPhoneme } = useAudioLipSync();
  const { setExpression, resetExpressions } = useVRMExpressions();
  const { animate, currentAnimation } = useVRMAnimations();
  
  return (
    <div className="controls">
      {/* Realtime Voice Chat */}
      <div>
        <h3>Voice Chat</h3>
        <button onClick={isConnected ? disconnect : connect}>
          {isConnected ? '🔴 Disconnect' : '🎤 Connect'}
        </button>
      </div>
      
      {/* Lip Sync Controls */}
      <div>
        <h3>Lip Sync</h3>
        <button 
          onClick={() => analyzeLipSync('/audio/sample.wav')}
          disabled={isAnalyzing}
        >
          {isAnalyzing ? 'Analyzing...' : 'Test Lip Sync'}
        </button>
        <button onClick={stopLipSync}>Stop</button>
        {currentPhoneme && (
          <p>Phoneme: {currentPhoneme.phoneme} ({currentPhoneme.intensity.toFixed(2)})</p>
        )}
      </div>
      
      {/* Expression Controls */}
      <div>
        <h3>Expressions</h3>
        <button onClick={() => setExpression('happy', 1)}>😊 Happy</button>
        <button onClick={() => setExpression('sad', 1)}>😢 Sad</button>
        <button onClick={() => setExpression('surprised', 1)}>😲 Surprised</button>
        <button onClick={resetExpressions}>Reset</button>
      </div>
      
      {/* Animation Controls */}
      <div>
        <h3>Animations</h3>
        <p>Current: {currentAnimation}</p>
        <button onClick={() => animate('idle')}>🧍 Idle</button>
        <button onClick={() => animate('walk')}>🚶 Walk</button>
        <button onClick={() => animate('dance')}>💃 Dance</button>
      </div>
      
      {/* Conversation History */}
      <div>
        <h3>Conversation</h3>
        {conversation.map((msg, i) => (
          <div key={i}>
            <strong>{msg.role}:</strong> {msg.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function Avatar3D() {
  const animations = {
    idle: '/animations/breathing.fbx',
    walk: '/animations/walking.fbx',
    dance: '/animations/dancing.fbx'
  };
  
  return (
    <Canvas camera={{ position: [0, 1, 3] }}>
      <Environment preset="studio" />
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} />
      
      <VRMAvatar
        src="/models/avatar.vrm"
        animations={animations}
        position={[0, -1, 0]}
      />
      
      <OrbitControls 
        target={[0, 0.5, 0]}
        enablePan={false}
        minDistance={1}
        maxDistance={5}
      />
    </Canvas>
  );
}

export default function App() {
  return (
    <KhaveeProvider config={{ realtime: realtimeProvider }}>
      <div className="app">
        <div className="avatar-container">
          <Avatar3D />
        </div>
        <div className="controls-container">
          <ControlPanel />
        </div>
      </div>
    </KhaveeProvider>
  );
}
}
```

## TypeScript Support

Full TypeScript support with comprehensive type definitions:

```tsx
import type {
  VRMAvatarProps,
  AnimationConfig,
  KhaveeConfig,
  RealtimeProvider,
  RealtimeTool,
  MouthState,
  PhonemeData,
  ChatStatus,
  Conversation
} from '@khaveeai/react';
```

## Performance Tips

- **Frustum Culling**: Disabled automatically for VRM models
- **Vertex Optimization**: Uses VRMUtils for performance optimization
- **Smooth Transitions**: Configurable lerp factors for animations (delta * 8)
- **MFCC Audio Analysis**: Optimized real-time frequency analysis for lip sync
- **Memory Management**: Automatic cleanup of audio contexts and animation mixers

## Browser Support

- ✅ Chrome 88+
- ✅ Firefox 85+  
- ✅ Safari 14.1+
- ✅ Edge 88+

**Requirements:**
- WebRTC support (for real-time features)
- Web Audio API (for lip sync analysis)
- WebGL 2.0 (for VRM rendering)
- Meyda library (for MFCC analysis)

## Troubleshooting

### Common Issues

**Audio Analysis Not Working:**
```tsx
// Check Meyda import and audio context
const { analyzeLipSync, isAnalyzing } = useAudioLipSync();

if (!isAnalyzing) {
  console.log('Make sure Meyda is installed: npm install meyda');
}
```

**VRM Model Not Loading:**
```tsx
// Check model format and path
<VRMAvatar 
  src="/models/character.vrm"  // Must be .vrm format
  onLoad={() => console.log('VRM loaded successfully')}
/>
```

**Animations Not Playing:**
```tsx
// Check FBX/GLB file paths and format
const animations = {
  idle: '/animations/idle.fbx',  // Must be accessible FBX or GLB files
  walk: '/animations/walk.fbx'
};

// Check if animations are loaded
const { availableAnimations } = useVRMAnimations();
console.log('Available animations:', availableAnimations);
```

**Expressions Not Working:**
```tsx
// Check VRM model has expression support
const { expressions } = useVRMExpressions();
const vrm = useVRM();

if (vrm?.expressionManager) {
  console.log('Expression support:', Object.keys(vrm.expressionManager.expressionMap));
}
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](https://github.com/SolveServeSolution/khaveeai-sdk/blob/main/CONTRIBUTING.md).

## License

MIT © [KhaveeAI](https://github.com/SolveServeSolution/khaveeai-sdk)

---

**Need help?** Check out our [examples](https://github.com/SolveServeSolution/khaveeai-sdk/tree/main/examples) or [open an issue](https://github.com/SolveServeSolution/khaveeai-sdk/issues).