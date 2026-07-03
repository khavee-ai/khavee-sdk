/**
 * packages/wp-bundle/src/mount.tsx
 *
 * Renders one independent KhaveeProvider+avatar render tree into a single
 * mount-point React root. A new OpenAIRealtimeProvider instance is
 * constructed per call (never a module-level singleton) so multiple
 * shortcode/block instances on one page never share connection state.
 *
 * Per the backend-proxy assumption (CLAUDE.md Architectural Constraints):
 * this module ALWAYS constructs the provider with useProxy: true and a
 * proxyEndpoint, with no secret credential field passed alongside it.
 * voice/instructions passed here flow into the provider's own sessionConfig
 * POST body
 * (audio.output.voice / instructions), validated server-side by the REST
 * route (D-05, plan 08-03) — this module does not add any separate
 * override-style field or make any additional network call beyond the one
 * request OpenAIRealtimeProvider already sends.
 *
 * `model` flows the admin's globally-configured model (AvatarRenderer's
 * public_safe() output) straight into the constructor config so the bundle
 * never silently falls back to OpenAIRealtimeProvider's own hardcoded
 * default — discovered live (post-Phase-8 UAT) when an account without
 * access to the old constructor default got `model_not_found`.
 *
 * Phase 9 (plan 09-05): KhaveeAvatarConfig is owned by config.ts and
 * re-exported from here so packages/wp-bundle/src/index.ts:17
 * (`import type { KhaveeAvatarConfig } from "./mount"`) remains unchanged.
 * AvatarScene is now config-driven: camera preset (position+fov via
 * resolveSceneDefaults), ambient light intensity, avatar scale, avatar
 * offset X/Y, and optional transparent canvas. ChatBox mounts as a flex
 * sibling of AvatarScene inside KhaveeProvider when config.chatShow is
 * true — shares the existing realtime session via useRealtime().sendMessage,
 * no second connection is opened (T-09-05-04 mitigated).
 *
 * Lip-sync (STUDIO-04): automatic reuse — VRMAvatar is inside KhaveeProvider,
 * so useRealtime's existing effect (onAudioData → RealtimeAudioAnalyzer →
 * setMultipleExpressions → VRMAvatar blend shapes) runs unchanged.
 * useRealtime.ts and VRMAvatar.tsx are NOT modified by this plan.
 *
 * Security (T-09-05-01): bgColor is applied via React's style={{ background }}
 * (React's CSS-property stringification prevents CSS injection — no innerHTML
 * path). bgImageUrl originates from wp_get_attachment_url (int-cast attachment
 * ID in PHP — no free-form URL).
 */
import { useState, type CSSProperties } from "react";
import type { Root } from "react-dom/client";
import { OpenAIRealtimeProvider } from "@khaveeai/providers-openai-realtime";
import { KhaveeProvider, VRMAvatar } from "@khaveeai/react";
import { Canvas } from "@react-three/fiber";
import { ClickToTalkOverlay } from "./ui/ClickToTalkOverlay";
import { ErrorOverlay } from "./ui/ErrorOverlay";
import { ChatBox } from "./ui/ChatBox";
import { ControlBar } from "./ui/ControlBar";
import { resolveSceneDefaults, IDLE_ANIMATION_URL } from "./config";
import type { KhaveeAvatarConfig } from "./config";

// Re-export so index.ts:17 `import type { KhaveeAvatarConfig } from "./mount"` continues to work.
export type { KhaveeAvatarConfig } from "./config";

// ── AvatarScene ────────────────────────────────────────────────────────────────
// Config-driven 3D scene. resolveSceneDefaults() provides all ?? fallbacks so
// existing Phase-8 blocks with no new config keys render identically.
//
// Transparent-background (Pitfall 6 — RESEARCH): gl={{ alpha: true }} on Canvas
// enables alpha blending in WebGL. The container's CSS background is set on the
// .khaveeai-root div (NOT via scene.background — three.js scene.background
// overrides the WebGL clear colour, defeating gl.alpha).
//
// Lip-sync (STUDIO-04): no new code here. VRMAvatar inside KhaveeProvider means
// useRealtime auto-wires onAudioData → RealtimeAudioAnalyzer →
// setMultipleExpressions. useRealtime.ts and VRMAvatar.tsx are UNCHANGED.
function AvatarScene({ config }: { config: KhaveeAvatarConfig }) {
  const scene = resolveSceneDefaults(config);
  const avatarUrl = config.avatarUrl ?? "";
  // avatarScale is a uniform multiplier; VRMAvatar accepts an [x, y, z] tuple.
  const uniformScale: [number, number, number] = [
    scene.avatarScale,
    scene.avatarScale,
    scene.avatarScale,
  ];

  return (
    <Canvas
      camera={{ position: scene.cameraPosition, fov: scene.cameraFov }}
      gl={config.bgTransparent === true ? { alpha: true } : undefined}
    >
      {/* lightIntensity is config-driven (c.lightIntensity ?? 1.0); was hardcoded 1 */}
      <ambientLight intensity={scene.lightIntensity} />
      <directionalLight position={[10, 10, 5]} intensity={scene.directional} />
      {/* Always VRMAvatar, never branched on file extension: several
          "avatarUrl.glb" uploads in the wild are actually VRM avatars (VRM
          extension present, zero embedded animations, unlit material
          fallback) saved with a .glb filename — routing those through
          GLBAvatar left them in a permanent T-pose with no lighting
          response. VRMAvatar's VRMLoaderPlugin is additive on top of the
          standard GLTFLoader, so a genuinely plain (non-VRM) .glb still
          loads and displays, just without humanoid/expression features
          (found 2026-07-02, testing a real .glb avatar). */}
      {avatarUrl ? (
        <VRMAvatar
          src={avatarUrl}
          position={[scene.avatarOffsetX, scene.avatarOffsetY, 0]}
          scale={uniformScale}
          animations={IDLE_ANIMATION_URL ? { idle: IDLE_ANIMATION_URL } : undefined}
        />
      ) : null}
    </Canvas>
  );
}

// ── AppRoot ────────────────────────────────────────────────────────────────────
// Split out from mountAvatarInstance so isChatOpen can be React state: the
// admin's config.chatShow only gates whether a chat panel can exist at all
// (a build-time/publish-time choice); isChatOpen is the visitor's own runtime
// show/hide toggle, wired to ControlBar's chat button (mirrors khavee-app's
// PreviewControls.tsx setIsChatOpen). Starts open whenever chat is enabled.
function AppRoot({
  config,
  containerStyle,
}: {
  config: KhaveeAvatarConfig;
  containerStyle: CSSProperties;
}) {
  const placement = config.chatPlacement ?? "beside";
  const chatEnabled = config.chatShow === true;
  const [isChatOpen, setIsChatOpen] = useState(chatEnabled);

  return (
    <div className="khaveeai-root" style={containerStyle}>
      {chatEnabled ? (
        // Layout wrapper for side-by-side (beside) or stacked (below) layout.
        // CSS in styles.css: .khaveeai-layout + .khaveeai-layout--{beside|below}.
        // ClickToTalkOverlay + ErrorOverlay are siblings of this div so they
        // overlay the entire widget (position: absolute; inset: 0 from styles.css).
        <div className={`khaveeai-layout khaveeai-layout--${placement}`}>
          {config.avatarUrl ? <AvatarScene config={config} /> : null}
          {isChatOpen && <ChatBox placement={placement} />}
        </div>
      ) : (
        // No chat panel: AvatarScene fills .khaveeai-root (no layout wrapper).
        config.avatarUrl ? <AvatarScene config={config} /> : null
      )}
      <ClickToTalkOverlay />
      <ErrorOverlay />
      <ControlBar
        chatEnabled={chatEnabled}
        isChatOpen={isChatOpen}
        onToggleChat={() => setIsChatOpen((v) => !v)}
      />
    </div>
  );
}

export function mountAvatarInstance(root: Root, config: KhaveeAvatarConfig): void {
  // OpenAIRealtimeProvider construction is UNCHANGED from Phase 8 —
  // same useProxy/proxyEndpoint/voice/instructions/model arguments.
  const provider = new OpenAIRealtimeProvider({
    useProxy: true,
    proxyEndpoint: config.restUrl,
    voice: config.voice,
    instructions: config.instructions,
    model: config.model,
  });

  // ── Container styles ─────────────────────────────────────────────────────────
  // Applied to .khaveeai-root via React's style prop so React's CSS-property
  // stringification handles escaping (T-09-05-01: no innerHTML/CSS injection).
  // Width:      containerWidth (px) → fullWidth (100%) → undefined (CSS-driven).
  // Height:     containerHeight (px) → undefined.
  // Background: bgTransparent → "transparent"; color → bgColor; image → url().
  const containerStyle: CSSProperties = {};
  if (config.containerWidth) {
    containerStyle.width = `${config.containerWidth}px`;
  } else if (config.fullWidth) {
    containerStyle.width = "100%";
  }
  if (config.containerHeight) {
    containerStyle.height = `${config.containerHeight}px`;
  }
  if (config.bgTransparent) {
    containerStyle.background = "transparent";
  } else if (config.bgType === "color" && config.bgColor) {
    containerStyle.background = config.bgColor;
  } else if (config.bgType === "image" && config.bgImageUrl) {
    containerStyle.backgroundImage = `url(${config.bgImageUrl})`;
    containerStyle.backgroundSize = "cover";
    containerStyle.backgroundPosition = "center";
  }

  root.render(
    <KhaveeProvider config={{ realtime: provider }}>
      <AppRoot config={config} containerStyle={containerStyle} />
    </KhaveeProvider>
  );
}
