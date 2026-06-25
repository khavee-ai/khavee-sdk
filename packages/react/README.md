# @khaveeai/react

[![npm version](https://img.shields.io/npm/v/@khaveeai/react.svg)](https://www.npmjs.com/package/@khaveeai/react)
[![license](https://img.shields.io/npm/l/@khaveeai/react.svg)](../../LICENSE)

React components and hooks for rendering and animating VRM/GLB avatars, with optional voice-chat state built on top of a `RealtimeProvider` from any `@khaveeai/providers-*` package.

This is the rendering + state layer — it has no vendor logic of its own:

- Renders a `.vrm` model (`VRMAvatar`) or `.glb`/`.gltf` model (`GLBAvatar`) inside an `@react-three/fiber` `<Canvas>`.
- Holds shared avatar state (VRM instance, expressions, current animation) in one React context (`KhaveeProvider`).
- Optionally wraps a `RealtimeProvider` and exposes it via `useRealtime()`.
- Automatically drives mouth shapes and talking animations from whatever provider you pass in — no manual phoneme/audio wiring.

Every voice backend (`OpenAIRealtimeProvider`, `GenericPipelineProvider`, etc.) implements the same `RealtimeProvider` interface, so this package never needs to know which vendor is actually running.

## Contents

- [Install](#install)
- [`KhaveeProvider`](#khaveeprovider)
- [`VRMAvatar`](#vrmavatar)
- [`GLBAvatar`](#glbavatar)
- [`useRealtime()`](#userealtime)
- [Swapping providers without changing any JSX](#swapping-providers-without-changing-any-jsx)
- [`useVRMExpressions()`](#usevrmexpressions)
- [Other exports](#other-exports)

## Install

```bash
npm install @khaveeai/react @khaveeai/core
npm install react @react-three/fiber @react-three/drei three @pixiv/three-vrm
```

`meyda` is a direct dependency of `@khaveeai/react` and is installed automatically — it powers the MFCC-based lip-sync analysis used by `useRealtime()` and `useAudioLipSync()`.

You'll also need a concrete provider package for voice/chat features, e.g.:

```bash
npm install @khaveeai/providers-openai-realtime
# or
npm install @khaveeai/providers-generic-stt-tts
```

## `KhaveeProvider`

`KhaveeProvider` is the root context provider. Wrap your app (or at least the part of the tree that contains your avatar and chat UI) with it.

`config` is **optional** — if you only want to render a VRM/GLB avatar with no voice chat, you can omit it entirely:

```tsx
import { KhaveeProvider, VRMAvatar } from '@khaveeai/react';
import { Canvas } from '@react-three/fiber';

function App() {
  return (
    <KhaveeProvider>
      <Canvas>
        <VRMAvatar src="/models/character.vrm" />
      </Canvas>
    </KhaveeProvider>
  );
}
```

When you do want voice/chat, `config` takes a `KhaveeConfig` object whose relevant field is literally named `realtime`, holding a `RealtimeProvider` instance:

```tsx
import { KhaveeProvider, VRMAvatar } from '@khaveeai/react';
import { Canvas } from '@react-three/fiber';
import { OpenAIRealtimeProvider } from '@khaveeai/providers-openai-realtime';

const realtime = new OpenAIRealtimeProvider({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY!,
  voice: 'coral',
});

function App() {
  return (
    <KhaveeProvider config={{ realtime }}>
      <Canvas>
        <VRMAvatar src="/models/character.vrm" />
      </Canvas>
    </KhaveeProvider>
  );
}
```

`KhaveeProvider` does not auto-connect the provider — you (or a component using `useRealtime()`) must call `connect()` explicitly.

## `VRMAvatar`

Renders a `.vrm` model and handles everything needed to animate it: loading, expression blending, idle/talk animations, and natural blinking.

**Props** (`VRMAvatarProps`):

| Prop | Type | Default | Description |
|------|------|---------|--------------|
| `src` | `string` | — (required) | URL or path to the `.vrm` file |
| `position` | `[number, number, number]` | `[0, 0, 0]` | Position in 3D space |
| `rotation` | `[number, number, number]` | `[0, Math.PI, 0]` | Rotation in radians |
| `scale` | `[number, number, number]` | `[1, 1, 1]` | Scale |
| `animations` | `AnimationConfig` (`{ [name: string]: string }`) | `undefined` | Map of animation name → FBX or GLB file URL |
| `enableBlinking` | `boolean` | `true` | Enables randomized natural blinking |

```tsx
<VRMAvatar
  src="/models/character.vrm"
  position={[0, -1, 0]}
  animations={{
    idle: '/animations/idle.fbx',     // auto-plays on load
    talk1: '/animations/talk_1.fbx',
    gesture_nod: '/animations/gesture_nod.fbx',
  }}
  enableBlinking={true}
/>
```

What happens automatically — no extra wiring needed:

- **Lip sync** — reads `expressions` from `KhaveeProvider` context every frame and applies them to the VRM's `expressionManager`. `useRealtime()`'s built-in analyzer drives the mouth.
- **Blinking** — randomized blink timer (~0.1–4s) when `enableBlinking` is `true`.
- **Talking animations** — any clip in `animations` named with `"talk"`/`"gesture"`/`"speak"` plays automatically while `chatStatus === "speaking"`. You just supply the files.
- **Mixamo remapping** — FBX bone names are remapped to VRM bones automatically; GLB clips are used as embedded animations (also remapped if Mixamo-sourced).

There's no separate prop or API for manually pushing phoneme data — `enableBlinking` and `animations` are the only knobs.

## `GLBAvatar`

Renders a `.glb`/`.gltf` model that already contains both the mesh **and** its animations in one file (e.g. exported from Blender or downloaded with embedded animation clips).

**Props** (`GLBAvatarProps`):

| Prop | Type | Default | Description |
|------|------|---------|--------------|
| `src` | `string` | — (required) | URL or path to the `.glb`/`.gltf` file |
| `position` | `[number, number, number]` | `[0, 0, 0]` | Position in 3D space |
| `rotation` | `[number, number, number]` | `[0, 0, 0]` | Rotation in radians |
| `scale` | `[number, number, number]` | `[1, 1, 1]` | Scale |
| `autoPlayAnimation` | `string \| number` | `0` (first animation) | Animation name or index to play automatically on load |

```tsx
<GLBAvatar
  src="/models/dragon.glb"
  autoPlayAnimation="idle"
  position={[0, 0, 0]}
/>
```

**Different from `VRMAvatar`:** GLB models usually have no standard mouth blendshapes, so `GLBAvatar` does **not** do blendshape lip sync. Instead, while `chatStatus === "speaking"`, it switches to an embedded clip whose name contains `"talk"`/`"gesture"`/`"speak"` (back to idle when speech ends). No matching clip names → no special behavior during speech.

In short: `VRMAvatar` → mouth movement. `GLBAvatar` → whole-body animation switching.

Animations on a `GLBAvatar` (or `VRMAvatar`) can also be controlled manually with `useAnimations()`:

```tsx
const { animate } = useAnimations();
<button onClick={() => animate('walk')}>Walk</button>
```

## `useRealtime()`

Connects your UI to the active `RealtimeProvider` (whatever was passed as `config.realtime` to `KhaveeProvider`). Must be called inside a `KhaveeProvider` that has `config.realtime` set — otherwise it throws.

Returned fields:

| Field | Type | Description |
|-------|------|--------------|
| `isConnected` | `boolean` | Whether the provider's connection is active |
| `chatStatus` | `'stopped' \| 'ready' \| 'listening' \| 'thinking' \| 'speaking' \| 'starting'` | Current pipeline state |
| `conversation` | `Conversation[]` | Full message history (`id`, `role`, `text`, `timestamp`, `isFinal`, `status`) |
| `currentVolume` | `number` | Current output volume level reported by the provider |
| `isThinking` | `boolean` | Convenience flag, `true` when `chatStatus === 'thinking'` |
| `currentPhoneme` | `PhonemeData \| null` | Most recently detected phoneme (for debugging/visualizing lip sync) |
| `isMicEnabled` | `boolean` | Whether the microphone is currently enabled |
| `connect` | `() => Promise<void>` | Connects the provider |
| `disconnect` | `() => Promise<void>` | Disconnects the provider |
| `sendMessage` | `(text: string) => Promise<void>` | Sends a text message/turn |
| `interrupt` | `() => void` | Interrupts the current AI response |
| `registerFunction` | `(tool: RealtimeTool) => void` | Registers a tool/function for the provider to call |
| `toggleMicrophone` | `() => boolean` | Toggles mic on/off, returns the new enabled state |
| `enableMicrophone` | `() => void` | Enables the microphone |
| `disableMicrophone` | `() => void` | Disables the microphone |
| `startAutoLipSync` | `() => Promise<void>` | Manually (re)starts the automatic lip-sync analyzer (mostly for debugging — it starts itself when TTS audio becomes available) |
| `stopAutoLipSync` | `() => void` | Stops the automatic lip-sync analyzer |

A minimal chat UI:

```tsx
import { useRealtime } from '@khaveeai/react';
import { useState } from 'react';

function ChatUI() {
  const { isConnected, connect, disconnect, conversation, sendMessage, chatStatus } = useRealtime();
  const [text, setText] = useState('');

  return (
    <div>
      <button onClick={isConnected ? disconnect : connect}>
        {isConnected ? 'Disconnect' : 'Connect'}
      </button>
      <p>Status: {chatStatus}</p>

      <ul>
        {conversation.map((msg) => (
          <li key={msg.id}>
            <strong>{msg.role}:</strong> {msg.text}
          </li>
        ))}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) {
            sendMessage(text);
            setText('');
          }
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
```

Internally, `useRealtime()` also runs the built-in MFCC-based phoneme analyzer against whatever audio analyser the provider exposes via `getAudioAnalyser()`, and pushes the detected mouth shapes into the same expression state that `VRMAvatar` reads — this is what makes lip sync automatic.

## Swapping providers without changing any JSX

`useRealtime()` and `<VRMAvatar>` only depend on the `RealtimeProvider` interface from `@khaveeai/core`, not on any specific vendor. The exact same component tree works unchanged regardless of which concrete provider you instantiate:

```tsx
// Option A: OpenAI's full-duplex Realtime API
import { OpenAIRealtimeProvider } from '@khaveeai/providers-openai-realtime';
const realtime = new OpenAIRealtimeProvider({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY!,
  voice: 'coral',
});

// Option B: a composed pipeline that can mix non-OpenAI vendors at the STT/TTS stage
import { GenericPipelineProvider } from '@khaveeai/providers-generic-stt-tts';
const realtime = new GenericPipelineProvider({
  /* vad/stt/llm/tts adapters configured here */
});
```

```tsx
// Identical regardless of which `realtime` instance above was used:
function App() {
  return (
    <KhaveeProvider config={{ realtime }}>
      <Canvas>
        <VRMAvatar src="/models/character.vrm" />
      </Canvas>
      <ChatUI />
    </KhaveeProvider>
  );
}
```

This is the core value of the package: `useRealtime()` + `<VRMAvatar>` give you a complete voice-avatar UI, and the provider instance is the only thing that changes when you swap vendors.

## `useVRMExpressions()`

```tsx
const { expressions, setExpression, resetExpressions, setMultipleExpressions } = useVRMExpressions();
```

This is a thin wrapper over the same `KhaveeProvider` context state that `VRMAvatar` already reads and applies automatically every frame. You do **not** need it for normal lip sync — `useRealtime()` already calls `setMultipleExpressions()` internally when phonemes are detected. Use `useVRMExpressions()` when you want manual or debug control over facial expressions, e.g. triggering a one-off "happy" expression from a button:

```tsx
function ExpressionDebugPanel() {
  const { setExpression, resetExpressions } = useVRMExpressions();

  return (
    <div>
      <button onClick={() => setExpression('happy', 1)}>Happy</button>
      <button onClick={resetExpressions}>Reset</button>
    </div>
  );
}
```

## Usage requirements

- `<VRMAvatar>` and `<GLBAvatar>` must be rendered inside an `@react-three/fiber` `<Canvas>`.
- All hooks (`useRealtime`, `useVRMExpressions`, `useAnimations`, `useVRM`, `useKhavee`) and both avatar components must be used inside a `<KhaveeProvider>`. `useRealtime()` additionally requires `KhaveeProvider`'s `config.realtime` to be set.

## Other exports

- `useAnimations()` — `{ currentAnimation, animate, stopAnimation, availableAnimations }`. Works with both `VRMAvatar` and `GLBAvatar`.
- `useVRMAnimations()` — deprecated alias for `useAnimations()`, kept for backward compatibility.
- `useVRM()` — returns the raw loaded `VRM` instance (or `null` before it loads).
- `useKhavee()` — returns the full internal context object (`vrm`, `expressions`, `currentAnimation`, `realtimeProvider`, `chatStatus`, etc.). Intended for advanced use; prefer the more specific hooks above.
- `useAudioLipSync()` — `{ analyzeLipSync, stopLipSync, isAnalyzing, currentPhoneme, audioElement }`. Analyzes a pre-recorded audio file (not a live `RealtimeProvider` stream) for lip sync, useful for pre-rendered TTS clips played outside of a `RealtimeProvider`.
