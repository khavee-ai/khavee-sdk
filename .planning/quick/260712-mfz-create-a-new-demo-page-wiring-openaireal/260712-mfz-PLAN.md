---
quick_id: 260712-mfz
type: quick
files_modified:
  - src/app/openai-avatar-test/page.tsx
autonomous: true
---

<objective>
Create a new Next.js demo page (`src/app/openai-avatar-test/page.tsx`) that mounts the SDK's `VRMAvatar` alongside `OpenAIRealtimeProvider` (the full-duplex WebRTC provider), so a human can start a real OpenAI Realtime voice conversation and visually verify two things at once: (1) audio-driven lipsync — `useRealtime`'s `RealtimeAudioAnalyzer` auto-pulls `OpenAIRealtimeProvider.getAudioAnalyser()` and drives mouth/phoneme state through `KhaveeProvider`'s `expressions`, this should "just work" once the avatar is mounted under the same `KhaveeProvider` as the realtime config — and (2) the Phase 10 shared animation module's chatStatus-driven crossfades (idle -> listening -> thinking -> speaking -> idle) reacting to a real conversation instead of button-triggered test clips.

Purpose: Phase 10 (shared-animation-architecture-crossfade-engine) migrated VRMAvatar/GLBAvatar onto a shared `useAnimationController`, but the only test pages exercising it (`glb-avatar-test`, `vrm-avatar-test`) trigger transitions via manual buttons. This page is the first to exercise both the crossfade engine AND the pre-existing phoneme-lipsync system together against a live conversation, closer to real production usage.
Output: `src/app/openai-avatar-test/page.tsx` — a new dev/test page, not shipped SDK surface.
</objective>

<context>
Existing references confirmed by direct inspection (Phase 10 just changed VRMAvatar internals, so these were re-verified rather than assumed):
- `packages/react/src/VRMAvatar.tsx:114-121` — current `VRMAvatarProps`: `{ src: string; position?; rotation?; scale?; animations?: AnimationConfig; enableBlinking?: boolean }`. No `animations` prop is required — chatStatus-driven crossfades work off whatever clips are loaded via `animations`, but the component works fine with none passed (it will just have nothing to crossfade between besides idle/no-op).
- `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts:824` — exposes `getAudioAnalyser(): { analyser, audioContext } | ...`. Config fields confirmed: `useProxy`, `proxyEndpoint`, `voice`, `instructions`.
- `packages/react/src/hooks/useRealtime.ts:439-442` — `RealtimeAudioAnalyzer` automatically calls `this.config.realtimeProvider.getAudioAnalyser?.()` and wires the returned analyser into phoneme/mouth-state detection. No manual analyser wiring needed in the new page — mounting `VRMAvatar` under the same `KhaveeProvider` that holds the `OpenAIRealtimeProvider` instance is sufficient.
- `src/app/openai/page.tsx` — existing reference for `OpenAIRealtimeProvider` config (`useProxy: true, proxyEndpoint: '/api/negotiate', voice: 'shimmer', instructions: '...'`) and `useRealtime()` hook usage (`connect`, `disconnect`, `sendMessage`, `conversation`, `isConnected`). This page currently renders NO avatar — confirmed by inspection.
- `src/app/generic-demo/page.tsx` — layout reference to mirror: 3D `Canvas` + `VRMAvatar` on one side, chat UI (connect/disconnect buttons, `chatStatus` indicator, conversation log, text-input fallback) on the other, both inside one `KhaveeProvider`.
- `src/app/api/negotiate/route.ts` — existing backend proxy endpoint; confirmed present, not modified by this plan.
- `public/models/male.vrm` — confirmed present (same model `generic-demo` uses).
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create the OpenAI Realtime + VRM avatar lipsync test page</name>
  <files>src/app/openai-avatar-test/page.tsx</files>
  <read_first>
    - src/app/generic-demo/page.tsx (layout template: Canvas + VRMAvatar left, chat UI + chatStatus indicator right, both inside one KhaveeProvider)
    - src/app/openai/page.tsx (OpenAIRealtimeProvider config + useRealtime hook usage template)
    - packages/react/src/VRMAvatar.tsx:114-121 (current VRMAvatarProps — src, position, rotation, scale, animations, enableBlinking)
  </read_first>
  <action>
    Create `src/app/openai-avatar-test/page.tsx` as a `"use client"` Next.js page:
    1. Instantiate `new OpenAIRealtimeProvider({ useProxy: true, proxyEndpoint: '/api/negotiate', voice: 'shimmer', instructions: 'You are a helpful, conversational AI assistant. Keep responses natural and not too long, so lipsync and animation transitions are easy to observe.' })` at module scope (matching `src/app/openai/page.tsx`'s pattern).
    2. Wrap the page in `<KhaveeProvider config={{ realtime: openaiProvider }}>`.
    3. Left/top half: a `<Canvas camera={{ position: [0, 1.5, 3], fov: 50 }} shadows>` containing `<ambientLight>`, `<directionalLight>`, `<Suspense fallback={null}><VRMAvatar src="/models/male.vrm" enableBlinking /></Suspense>`, and `<OrbitControls target={[0, 1, 0]} />` — mirror `generic-demo`'s `Scene` component structure. Do not pass an `animations` prop (no bundled FBX clips are wired for this page) — chatStatus transitions will crossfade against whatever base state VRMAvatar resolves without extra clips; this is fine for verifying lipsync + connect/disconnect + chatStatus reactivity, which is the page's purpose.
    4. Right/bottom half: use `useRealtime()` to get `connect`, `disconnect`, `sendMessage`, `conversation`, `isConnected`, `chatStatus`. Render Connect/Disconnect buttons (disabled appropriately), a visible `chatStatus` badge (mirror generic-demo's `Status: {chatStatus}` div), a scrollable conversation log (user/assistant messages), and a text-input fallback form calling `sendMessage` (mirror `src/app/openai/page.tsx`'s form pattern) so the page is usable even without a working microphone.
    5. Add a short on-page note (plain text, not a code comment) telling the human what to check: "Speak into your mic after connecting. Watch for: lips moving in sync with AI speech audio, and smooth animated transitions as chatStatus changes (idle -> listening -> thinking -> speaking)."
    Keep styling consistent with `generic-demo`'s Tailwind utility classes (this repo uses Tailwind v4 site-wide per CLAUDE.md) — no new UI library.
  </action>
  <verify>
    <automated>cd /Users/whitemalt/Documents/khavee-sdk && grep -q "OpenAIRealtimeProvider" src/app/openai-avatar-test/page.tsx && grep -q "VRMAvatar" src/app/openai-avatar-test/page.tsx && grep -q "KhaveeProvider" src/app/openai-avatar-test/page.tsx && grep -q "proxyEndpoint: '/api/negotiate'" src/app/openai-avatar-test/page.tsx && pnpm exec tsc --noEmit -p tsconfig.json</automated>
  </verify>
  <acceptance_criteria>
    - `src/app/openai-avatar-test/page.tsx` exists and mounts `<VRMAvatar src="/models/male.vrm" />` inside a `<Canvas>` inside `<KhaveeProvider config={{ realtime: openaiProvider }}>`
    - `openaiProvider` is a `new OpenAIRealtimeProvider({ useProxy: true, proxyEndpoint: '/api/negotiate', ... })` instance, matching `src/app/openai/page.tsx`'s config pattern
    - Page exposes Connect/Disconnect buttons wired to `useRealtime()`'s `connect`/`disconnect`, a visible `chatStatus` indicator, a conversation log, and a text-input fallback wired to `sendMessage`
    - No modifications made to `OpenAIRealtimeProvider`, `VRMAvatar`, `GLBAvatar`, the shared animation module, `src/app/openai/page.tsx`, or `src/app/generic-demo/page.tsx`
    - Root `pnpm exec tsc --noEmit` (Next app typecheck) exits 0
  </acceptance_criteria>
  <done>A runnable page at /openai-avatar-test mounts VRMAvatar + OpenAIRealtimeProvider together so a human can start a live voice conversation and visually verify audio-driven lipsync and chatStatus-driven crossfade animation reacting to a real conversation.</done>
</task>

</tasks>

<verification>
- `pnpm exec tsc --noEmit -p tsconfig.json` (root Next app typecheck) exits 0 — note a pre-existing, unrelated error in `src/app/generic-demo/__tests__/roundtrip-audio-contract.test.ts` (missing `vitest` type declarations at root scope) is expected and not caused by this plan; only fail verification on errors referencing `openai-avatar-test`
- `grep` gates confirm the page wires `OpenAIRealtimeProvider`, `VRMAvatar`, and `KhaveeProvider` together
</verification>

<success_criteria>
- A new page exists that a human can open, click Connect, speak, and observe both lipsync and Phase 10's chatStatus-driven crossfade animations reacting to a live OpenAI Realtime conversation
- No existing pages or SDK package code modified
</success_criteria>

<output>
Create `.planning/quick/260712-mfz-create-a-new-demo-page-wiring-openaireal/260712-mfz-SUMMARY.md` when done
</output>
