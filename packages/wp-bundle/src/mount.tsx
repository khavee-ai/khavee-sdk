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
 * Phase 9 (STUDIO-05): KhaveeAvatarConfig is now owned by config.ts and
 * re-exported from here so packages/wp-bundle/src/index.ts:17
 * (`import type { KhaveeAvatarConfig } from "./mount"`) remains unchanged.
 * AvatarScene and mountAvatarInstance are extended with config-driven scene
 * parameters in plan 09-05; this file carries the re-export only for now.
 */
import type { Root } from "react-dom/client";
import { OpenAIRealtimeProvider } from "@khaveeai/providers-openai-realtime";
import { KhaveeProvider, VRMAvatar, GLBAvatar } from "@khaveeai/react";
import { Canvas } from "@react-three/fiber";
import { ClickToTalkOverlay } from "./ui/ClickToTalkOverlay";
import { ErrorOverlay } from "./ui/ErrorOverlay";
import type { KhaveeAvatarConfig } from "./config";

// Re-export so index.ts:17 `import type { KhaveeAvatarConfig } from "./mount"` continues to work.
export type { KhaveeAvatarConfig } from "./config";

function AvatarScene({ avatarUrl }: { avatarUrl: string }) {
  const isGlb = avatarUrl.toLowerCase().endsWith(".glb");

  return (
    <Canvas camera={{ position: [0, 0, 5], fov: 50 }}>
      <ambientLight intensity={1} />
      <directionalLight position={[10, 10, 5]} intensity={2.5} />
      {isGlb ? <GLBAvatar src={avatarUrl} /> : <VRMAvatar src={avatarUrl} />}
    </Canvas>
  );
}

export function mountAvatarInstance(root: Root, config: KhaveeAvatarConfig): void {
  const provider = new OpenAIRealtimeProvider({
    useProxy: true,
    proxyEndpoint: config.restUrl,
    voice: config.voice,
    instructions: config.instructions,
    model: config.model,
  });

  root.render(
    <KhaveeProvider config={{ realtime: provider }}>
      <div className="khaveeai-root">
        {config.avatarUrl ? <AvatarScene avatarUrl={config.avatarUrl} /> : null}
        <ClickToTalkOverlay />
        <ErrorOverlay />
      </div>
    </KhaveeProvider>
  );
}
