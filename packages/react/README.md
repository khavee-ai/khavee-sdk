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
- [Facial performance](#facial-performance)
- [Scene & render quality](#scene--render-quality) — lighting, shadows, post-processing, backgrounds, camera
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

Renders a `.vrm` model and handles everything needed to animate it: loading, expression blending, state-driven clip crossfades, natural blinking, eye gaze, viseme lip sync and emotion — plus a tuned lighting rig and MToon material repair so it looks right without any scene setup.

```tsx
<VRMAvatar
  src="/models/character.vrm"
  position={[0, -1, 0]}
  animations={{
    idle: ['/animations/idle_1.fbx', '/animations/idle_2.fbx'],
    talking: ['/animations/talk_1.fbx', '/animations/talk_2.fbx'],
    thinking: '/animations/thinking.fbx',
    greeting: '/animations/wave.fbx',
  }}
/>
```

**Props** (`VRMAvatarProps`):

| Prop | Type | Default | Description |
|------|------|---------|--------------|
| `src` | `string` | — (required) | URL or path to the `.vrm` file |
| `position` | `[number, number, number]` | `[0, 0, 0]` | Position in 3D space |
| `rotation` | `[number, number, number]` | `[0, Math.PI, 0]` | Rotation in radians |
| `scale` | `[number, number, number]` | `[1, 1, 1]` | Scale |
| `animations` | `AnimationConfig` | `undefined` | Clip name → FBX/GLB URL, or an array of URLs. See [Animations](#animations) |
| `animationCycleOrder` | `"random" \| "sequential"` | `"random"` | How clips rotate when a status has 2+ matching clips. `"random"` never repeats back-to-back |
| `animationMinDwellSeconds` | `number` | `2` | Minimum seconds a clip plays before the cycle may swap it (the swap still waits for a loop boundary) |
| `enableBlinking` | `boolean` | `true` | Randomized natural blinking |
| `onLoad` | `() => void` | — | Fires once this model has loaded. Use this, not drei's `useProgress()` — the model load is invisible to it |
| `autoLighting` | `boolean` | `true` | Mount the tuned three-point light rig inside the avatar group. See [Lighting](#lighting) |
| `lighting` | `LightRigOptions` | `DEFAULT_LIGHT_RIG` | Per-light overrides for the rig. No effect when `autoLighting={false}` |
| `toneMapping` | `THREE.ToneMapping` | `THREE.CineonToneMapping` | Renderer tone mapping, applied Canvas-wide on mount |
| `castShadow` | `boolean` | `true` | Force `castShadow` on every mesh at load |
| `receiveShadow` | `boolean` | `true` | Force `receiveShadow` on every mesh at load |
| `anisotropy` | `number` | `8` | Texture anisotropy, clamped to the hardware max |
| `materialPreset` | `"repair" \| "off"` | `"repair"` | Repair badly authored MToon values (rim light, toon ramp, fully-lit surfaces) at load. `"off"` restores the authored values at runtime, no reload |
| `outlines` | `boolean` | `true` | Show/hide MToon outlines. Hidden outlines cost no draw calls; toggling does not reload |
| `outlineWidth` | `number` | — | Outline width in metres (clamped 0–0.05; 0.001–0.004 suits a person). Omit to draw only the outlines the asset authored — many author none. Applied at load |
| `smoothShading` | `boolean` | `false` | Weld coincident vertices and recompute normals to remove faceted shading. Mutates geometry, applied at load |
| `debugShading` | `boolean` | `false` | Render MToon's lit/shade boundaries for tuning. Development aid |
| `background` | `AvatarBackground` | — | Composite a backdrop inside the canvas and tint the rim light from it. See [Backgrounds](#backgrounds) |
| `onBackgroundError` | `(error: Error) => void` | — | Rejected URL scheme, failed load, CORS block or oversized image |

Props marked "applied at load" (`outlineWidth`, `smoothShading`) only take effect on a fresh mount — change the component's `key` to re-apply them.

What happens automatically — no extra wiring needed:

- **State-driven animation** — clips are picked by name from `chatStatus` and crossfaded. See [Animations](#animations).
- **Lip sync** — viseme-driven, with coarticulation smoothing and jaw motion. See [Facial performance](#facial-performance).
- **Eye gaze, blinking and emotion** — see [Facial performance](#facial-performance).
- **Mixamo remapping** — FBX bone names are remapped to VRM bones automatically; GLB clips are used as embedded animations (also remapped if Mixamo-sourced).

### Animations

`AnimationConfig` maps a clip name to one URL or an array of URLs:

```ts
interface AnimationConfig {
  [name: string]: string | string[];
}
```

The **key** — not the filename — is matched against `chatStatus` to decide what plays:

| `chatStatus` | Key matches |
|--------------|-------------|
| `ready` | `idle`, `ready`, `rest` |
| `listening` | `listen` |
| `thinking` | `think` |
| `speaking` | `talk`, `speak`, `gesture` |
| `starting` | `welcome`, `greet`, `hello`, `intro` |
| `stopped` | `stop`, `bye`, `goodbye`, `outro` |

Array entries are flattened to `idle_0`, `idle_1`, …, so they still match on the key prefix. When a status has more than one matching clip, the avatar rotates between them at loop boundaries (`ready`, `listening`, `thinking` and `speaking` cycle), ordered by `animationCycleOrder` and held for at least `animationMinDwellSeconds`. A clip is never cut mid-loop.

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
| `animationCycleOrder` | `"random" \| "sequential"` | `"random"` | Same as `VRMAvatar` |
| `animationMinDwellSeconds` | `number` | `2` | Same as `VRMAvatar` |
| `autoLighting`, `lighting`, `toneMapping`, `castShadow`, `receiveShadow`, `anisotropy`, `smoothShading`, `background`, `onBackgroundError` | | | Same as `VRMAvatar` |

MToon props (`materialPreset`, `outlines`, `outlineWidth`, `debugShading`) are VRM-only.

```tsx
<GLBAvatar
  src="/models/dragon.glb"
  autoPlayAnimation="idle"
  position={[0, 0, 0]}
/>
```

**Different from `VRMAvatar`:** GLB models usually have no standard mouth blendshapes, so `GLBAvatar` does **not** do blendshape lip sync or eye gaze. Instead it switches between embedded clips by name, using the same `chatStatus` matching as [Animations](#animations). No matching clip names → no special behavior during speech.

In short: `VRMAvatar` → face and body. `GLBAvatar` → whole-body animation switching.

Animations on a `GLBAvatar` (or `VRMAvatar`) can also be controlled manually with `useAnimations()`:

```tsx
const { animate } = useAnimations();
<button onClick={() => animate('walk')}>Walk</button>
```

## Facial performance

All `VRMAvatar`-only and automatic once the avatar is inside a `KhaveeProvider`.

**Eye gaze.** The eyes hold eye contact with the camera through the VRM's `lookAt`, with small saccades and the occasional glance away. Large gaze jumps carry a blink with them, the way real eyes do. Models without `lookAt` fall back to eye bones; models with neither are left alone.

**Lip sync.** Mouth shapes (`aa`, `ih`, `ou`, `ee`, `oh`) come from a viseme channel with two sources:

1. **TTS timing** (primary) — when the TTS adapter reports phoneme/viseme timing (`TTSProvider.speak`'s `onViseme`, see `@khaveeai/core`), the mouth follows the actual speech timeline.
2. **Audio analysis** (fallback) — when no timing exists (e.g. OpenAI TTS), the playing audio drives it: a client-side classifier picks the mouth *shape*, and the voice's loudness envelope sets how far it opens, so the mouth closes between syllables.

Both are smoothed with coarticulation (lip rounding anticipates upcoming vowels) and drive an additive jaw-bone motion on models that have a jaw bone. The channel is fed by `useRealtime()`, so at least one component in the tree must call it.

**Emotion.** Six emotions — `happy`, `sad`, `angry`, `surprised`, `neutral`, `thinking` — crossfade over ~0.5s and also shift gaze (sad looks down and away, thinking looks up and to the side) and can suggest a gesture (happy nods). Trigger one directly:

```tsx
const { setEmotionHint } = useKhavee();
setEmotionHint('happy', 0.8);   // intensity 0–1, default 0.7
setEmotionHint(null);           // fade back to idle
```

Or let the LLM choose one each turn with the zero-config tool from `@khaveeai/core`:

```tsx
import { createEmotionTool, emotionSystemPrompt } from '@khaveeai/core';

const realtime = new OpenAIRealtimeProvider({
  instructions: myInstructions + '\n\n' + emotionSystemPrompt,
});

function EmotionTool() {
  const { setEmotionHint } = useKhavee();
  useEffect(() => {
    realtime.registerFunction(createEmotionTool(setEmotionHint).tool);
  }, [setEmotionHint]);
  return null;
}
```

Invalid emotion names from the LLM are ignored; out-of-range intensities are clamped.

**Gestures.** `setGestureHint('nod' | 'shake')` plays a head nod or shake. While speaking, it waits for the current talk clip's loop boundary instead of interrupting it. `toolGesture` from `@khaveeai/core` is the matching LLM tool definition (supply your own `execute` that calls `setGestureHint`).

## Scene & render quality

### Lighting

`autoLighting` (on by default) mounts a three-point rig inside the avatar's group, so it moves with the avatar:

| Light | Default |
|-------|---------|
| `ambient` | intensity `0.25` |
| `key` | intensity `1.2`, `#fff4e6`, at `[4, 4, 1]` — casts the shadow |
| `fill` | intensity `0.15`, `#cfe0ff`, at `[-3, 1.5, 2]` |
| `rim` | intensity `1.6`, `#bcd4ff`, at `[-1.5, 3, -4]` |
| `shadow` | intensity `0.6`, mapSize `2048`, normalBias `0.02`, radius `4` |

Override any part with `lighting`. A bare number is shorthand for intensity:

```tsx
<VRMAvatar src="..." lighting={{ ambient: 0.6, key: { intensity: 1.5, color: '#ffffff' } }} />
```

The defaults are exported as `DEFAULT_LIGHT_RIG`, so scaling the whole rig from a single brightness setting is one line per light:

```tsx
const s = brightness; // e.g. 0–2, 1 = default
const lighting = {
  ambient: DEFAULT_LIGHT_RIG.ambient.intensity * s,
  key: DEFAULT_LIGHT_RIG.key.intensity * s,
  fill: DEFAULT_LIGHT_RIG.fill.intensity * s,
  rim: DEFAULT_LIGHT_RIG.rim.intensity * s,
};
```

Set `autoLighting={false}` to light the scene yourself.

### Shadows

The rig casts shadows, but nothing receives them unless the scene has a surface. Mount one of these once per scene, at the avatar's feet:

- `<ShadowFloor y={0} />` — a plane that is invisible except where a real cast shadow lands. Props: `y` (`0`), `size` (half-width, `10`), `opacity` (`0.35`).
- `<AvatarContactShadows y={0} />` — a soft contact-shadow blob that doesn't depend on the light. Props: `y` (`0`), `opacity` (`0.6`), `blur` (`2.5`), `scale` (`4`), `resolution` (`512`, clamped 128–2048), `far` (`2`), `color` (`"#000000"`), `frames` (`Infinity`).

### Post-processing

`<AvatarPostFX />` adds an effects chain inside the `<Canvas>`:

| Prop | Default | Description |
|------|---------|-------------|
| `bloom` | `true` | Glow on bright highlights. `bloomIntensity` (`0.5`), `bloomThreshold` (`0.3`), `bloomSmoothing` (`1`) |
| `smaa` | `true` | Subpixel morphological anti-aliasing, on top of the Canvas MSAA |
| `dof` | `false` | Depth of field. `true` or `{ subject, focusRange, bokehScale }` (defaults `[0, 1, 0]`, `0.6`, `20`). Focus tracks the subject's live camera distance, so it survives camera moves |
| `vignette` | `false` | `true` or `{ offset, darkness }` (defaults `0.35`, `0.55`) |
| `grading` | `false` | Colour grading. `true` or `{ saturation, hue, brightness, contrast }` (defaults `0.12`, `0`, `0`, `0.08`) |
| `toneMapping` | `"cineon"` | `"cineon" \| "aces-filmic" \| "agx" \| "neutral" \| "reinhard" \| "linear"` |

```tsx
<AvatarPostFX bloom={false} dof vignette />
```

Known limit: transparent face details (eyelashes, brows, eye highlights) don't write depth, so they stay sharp when DOF defocuses the rest of the face.

### Backgrounds

Pass `background` to the avatar to render the backdrop **inside** the canvas — it shares the scene's tone mapping, sits at a real depth (so DOF can blur it), and the rim light takes its colour from it:

```tsx
<VRMAvatar src="..." background={{ type: 'color', value: '#2b2f3a' }} />
<VRMAvatar src="..." background={{ type: 'image', url: '/bg/room.jpg', fit: 'cover' }} />
```

```ts
type AvatarBackground =
  | { type: 'color'; value: string }
  | { type: 'image'; url: string; fit?: 'cover' | 'contain'; distance?: number }; // fit 'cover', distance 6
```

- The image host **must send CORS headers**, or the texture is refused and `onBackgroundError` fires. Keep a CSS background behind the canvas if you want a fallback.
- Allowed URL schemes: `http:`, `https:`, `blob:`, and `data:` with an `image/` type. Images over 50 megapixels are rejected.
- Use it on at most one avatar per `<Canvas>`. Omit it to keep the canvas transparent — e.g. for screenshots.
- `<AvatarBackdrop background={…} onError={…} />` is the same backdrop as a standalone component, without the rim tint.

### Camera

`<AvatarCamera />` replaces your own camera controls with framing presets and subtle life:

| Prop | Default | Description |
|------|---------|-------------|
| `preset` | `"bust-shot"` | `"bust-shot"` (fov 35), `"medium-close-up"` (fov 40) or `"full-body"` (fov 50) |
| `position`, `target`, `fov` | from preset | Override the preset |
| `orbit` | `"locked"` | `"locked"`, `"constrained"` (clamped to flattering angles per preset) or `"free"` |
| `drift` | `true` | Procedural handheld drift (simplex noise, a few millimetres) |
| `reframe` | `true` | Pushes in 7% while `chatStatus === "speaking"` and eases back after |

Drift and reframe pause while the user is orbiting. `AvatarCamera` mounts drei's `CameraControls` as the default controls, so don't also mount `OrbitControls`/`CameraControls`, and it must be inside a `KhaveeProvider`.

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
| `toggleMicrophone` | `() => Promise<boolean>` | Toggles mic on/off, resolves to the new enabled state. Re-prompts for permission (and reconnects) if no mic stream exists yet |
| `enableMicrophone` | `() => Promise<void>` | Enables the microphone, re-prompting for permission if needed |
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
- `useKhavee()` — the full context object (`vrm`, `expressions`, `currentAnimation`, `realtimeProvider`, `chatStatus`, `setEmotionHint`, `setGestureHint`, `visemeChannel`, etc.). Prefer the more specific hooks above unless you need these.
- `useAudioLipSync()` — **deprecated.** Analyzes a pre-recorded audio file for lip sync. Live speech is handled by the viseme channel (see [Facial performance](#facial-performance)); this hook is kept only for existing callers.
- `DEFAULT_LIGHT_RIG` — the light rig's default values (see [Lighting](#lighting)).
- MToon utilities, for working on a loaded scene directly: `repairMToonMaterials(root, options?)`, `snapshotMToon(root)` / `restoreMToon(root, snapshot)`, `setMToonDebugMode(root, mode)`, `setMToonOutlines(...)`, `countOutlinedMaterials(root)`, plus `DEFAULT_REPAIR` and `FACE_DETAIL_MATERIAL_RE`. `VRMAvatar` already applies these through `materialPreset`, `outlines` and `debugShading`.
- Types: `AnimationConfig`, `AnimationCycleOrder`, `LightRigOptions`, `LightSpec`, `LightSetting`, `ShadowOptions`, `AvatarPostFXProps`, `AvatarToneMapping`, `DepthOfFieldOptions`, `VignetteOptions`, `GradingOptions`, `ShadowFloorProps`, `AvatarContactShadowsProps`, `AvatarBackground`, `AvatarBackdropProps`, `BackgroundFit`, `AvatarCameraProps`, `CameraPreset`, `OrbitMode`, `MaterialPreset`, `MToonDebugMode`, `EmotionHint`, `EmotionName`, `VisemeChannel`, and the MToon repair/outline result types.
