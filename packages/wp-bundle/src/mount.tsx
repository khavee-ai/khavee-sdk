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
 *
 * Quick task 260704-77n (FLOAT-01): when config.floating is true, AppRoot
 * renders FloatingWidget (./floating/FloatingWidget) instead of the inline
 * embed layout — containerStyle is not applied in that branch. AvatarScene
 * is exported so FloatingWidget can reuse it inside its own avatar area,
 * still nested inside the same KhaveeProvider constructed below.
 *
 * Bugfix (found live against wp-env, 2026-07-04): both AvatarScene usages
 * below are wrapped in AvatarErrorBoundary (./ui/AvatarErrorBoundary) —
 * @react-three/fiber's <Canvas> re-throws any internally-caught render
 * error on its own next render, so an uncaught GLB/VRM load failure would
 * otherwise unmount this ENTIRE mount point's React root (chat, controls,
 * everything), not just the avatar. See AvatarErrorBoundary.tsx.
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
import { AvatarErrorBoundary } from "./ui/AvatarErrorBoundary";
import { resolveSceneDefaults, IDLE_ANIMATION_URL } from "./config";
import type { KhaveeAvatarConfig } from "./config";
import { FloatingWidget } from "./floating/FloatingWidget";
import { CameraController } from "./CameraController";

// Re-export so index.ts:17 `import type { KhaveeAvatarConfig } from "./mount"` continues to work.
export type { KhaveeAvatarConfig } from "./config";

// ── AvatarScene ────────────────────────────────────────────────────────────────
// Config-driven 3D scene. resolveSceneDefaults() provides all ?? fallbacks so
// existing Phase-8 blocks with no new config keys render identically.
//
// Transparent-background (Pitfall 6 — RESEARCH): gl={{ alpha: true }} on Canvas
// enables alpha blending in WebGL. The container's CSS background is set on the
// .khaveeai-root div (NOT via scene.background — three.js scene.background
// overrides the WebGL clear colour, defeating gl.alpha). This is now a
// CONSTANT Canvas prop (no key-based remount) — see the root-cause note on
// the Canvas element below for why.
//
// Lip-sync (STUDIO-04): no new code here. VRMAvatar inside KhaveeProvider means
// useRealtime auto-wires onAudioData → RealtimeAudioAnalyzer →
// setMultipleExpressions. useRealtime.ts and VRMAvatar.tsx are UNCHANGED.
export function AvatarScene({ config }: { config: KhaveeAvatarConfig }) {
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
      // Quick task 260707-oyu (genuine fix, replacing the disproven
      // 260707-0u6 `key`-prop hypothesis — see PreviewScene.tsx's file-header
      // root-cause note for the full source-level trace): the prior
      // `key={bgTransparent ? "gl-alpha" : "gl-opaque"}` +
      // `gl={bgTransparent ? { alpha: true } : undefined}` branching assumed
      // the "opaque" (`gl={undefined}`) case produced a genuinely non-alpha
      // WebGLRenderer. It never did — @react-three/fiber's own
      // renderer-creation defaults hardcode `alpha: true` regardless, so
      // `gl={undefined}` was ALWAYS identical to `gl={{ alpha: true }}`. The
      // `key` therefore forced a full Canvas/WebGLRenderer/VRM-reload
      // teardown+rebuild on every single checkbox toggle for zero actual
      // alpha-context change — the more plausible source of a toggle
      // sequence going genuinely stuck (repeated WebGL context churn). Fix:
      // no `key`, a CONSTANT `gl={{ alpha: true }}` — the container's
      // `background` CSS (containerStyle, computed in mountAvatarInstance()
      // below from live config) is what actually switches transparent vs
      // opaque, with no Canvas remount required.
      camera={{ position: scene.cameraPosition, fov: scene.cameraFov }}
      gl={{ alpha: true }}
      // resize={{ offsetSize: true }} (found live, floating widget only):
      // r3f's <Canvas> sizes itself via react-use-measure, which by default
      // reads the container's getBoundingClientRect() — a value that
      // INCLUDES any CSS transform applied by an ancestor. This Canvas is
      // always mounted, even while FloatingWidget's panel is closed, and
      // the closed panel sits under `transform: scale(0.9) ...`
      // (styles.css .khaveeai-floating-widget[data-open="false"]
      // .khaveeai-floating-panel) — so the very first measurement locks in
      // exactly 90% of the panel's real size. Opening the panel only
      // animates that same `transform` back to scale(1); a CSS transform
      // never changes an element's own layout box, so ResizeObserver never
      // re-fires and the canvas stays stuck 10% undersized (visible as a
      // white gap below/beside the avatar, using the container's
      // background color) until something unrelated forces a real resize.
      // offsetSize:true switches the measurement to offsetWidth/
      // offsetHeight, which reflect layout box size only and ignore
      // ancestor transforms entirely — correct from the very first mount
      // regardless of the panel's open/closed transform state.
      resize={{ offsetSize: true }}
    >
      {/* camera-framing-mismatch debug session root-cause fix: the `camera`
          prop above is initialization-only — react-three-fiber's own
          default-camera setup additionally hardcodes camera.lookAt(0, 0, 0)
          once at Canvas creation, ignoring scene.cameraTarget entirely
          (see CameraController.tsx's file header for the full source-level
          trace). Without this component, the published page's camera aim
          silently diverged from the editor preview (which already applied
          this same correction via PreviewAvatarCanvas.tsx) even though
          position/fov were already identical between the two paths. */}
      <CameraController
        position={scene.cameraPosition}
        target={scene.cameraTarget}
        fov={scene.cameraFov}
      />
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

  // Site-wide floating launcher/panel layout (FLOAT-01) replaces the inline
  // embed layout entirely — containerStyle (width/height/background) is
  // deliberately NOT applied here; FloatingWidget owns its own fixed 360x520
  // panel sizing via CSS (styles.css khaveeai-floating- rules).
  if (config.floating === true) {
    return <FloatingWidget config={config} />;
  }

  return (
    <div className="khaveeai-root" style={containerStyle}>
      {chatEnabled ? (
        // Layout wrapper for side-by-side (beside) or stacked (below) layout.
        // CSS in styles.css: .khaveeai-layout + .khaveeai-layout--{beside|below}.
        // ClickToTalkOverlay + ErrorOverlay are siblings of this div so they
        // overlay the entire widget (position: absolute; inset: 0 from styles.css).
        <div className={`khaveeai-layout khaveeai-layout--${placement}`}>
          {config.avatarUrl ? (
            <AvatarErrorBoundary>
              <AvatarScene config={config} />
            </AvatarErrorBoundary>
          ) : null}
          {isChatOpen && <ChatBox placement={placement} />}
        </div>
      ) : (
        // No chat panel: AvatarScene fills .khaveeai-root (no layout wrapper).
        config.avatarUrl ? (
          <AvatarErrorBoundary>
            <AvatarScene config={config} />
          </AvatarErrorBoundary>
        ) : null
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

// Knowledge-base search tool: same RealtimeTool shape
// providers-rag/createRAGTool.ts establishes, but execute() calls this
// site's own WP REST route (holding the Platform API key server-side)
// instead of talking to a vector store directly — the browser can never
// hold that key. Registered on BOTH OpenAIRealtimeProvider and
// OpenAISTTTTSProvider identically since RealtimeTool is provider-agnostic
// (config.tools/registerFunction is the same shape on both).
function createKnowledgeSearchTool(searchUrl: string) {
  return {
    name: "search_knowledge_base",
    description:
      "Search the site's knowledge base for relevant information to answer user questions",
    parameters: {
      query: {
        type: "string" as const,
        required: true,
        description: "Search query to find relevant information",
      },
    },
    execute: async (args: any) => {
      try {
        const response = await fetch(searchUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: args?.query, topK: 5 }),
        });
        const body = await response.json();
        const results = body?.data?.results ?? [];

        if (results.length === 0) {
          return { success: true, message: "No relevant information found in the knowledge base." };
        }

        const formatted = results
          .map((r: any, i: number) => `[${i + 1}] ${r.content}`)
          .join("\n\n");

        return { success: true, message: `Found ${results.length} relevant documents:\n\n${formatted}` };
      } catch (error) {
        return {
          success: false,
          message: `Error searching knowledge base: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      }
    },
  };
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
    tools:
      config.knowledgeBaseEnabled && config.knowledgeSearchUrl
        ? [createKnowledgeSearchTool(config.knowledgeSearchUrl)]
        : undefined,
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
  } else {
    // .khaveeai-root (styles.css) only sets min-height:32px, never an
    // explicit height, and the published page gives it no other height
    // constraint either — left unset, .khaveeai-layout's height:100%
    // (styles.css) has no real ancestor height to resolve against, which
    // in practice made the chat panel's height not match the avatar
    // canvas's (same root cause fixed for the editor/preview path in
    // PreviewScene.tsx — see quick task 260709-h8x). 400px mirrors that
    // same fallback so the editor preview and published page agree.
    containerStyle.height = "400px";
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
