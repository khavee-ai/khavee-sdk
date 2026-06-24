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
 * proxyEndpoint — it never holds or passes an apiKey. voice/instructions
 * passed here flow into the provider's own sessionConfig POST body
 * (audio.output.voice / instructions), validated server-side by the REST
 * route (D-05, plan 08-03) — this module does not add any separate
 * override-style field or make any additional network call beyond the one
 * request OpenAIRealtimeProvider already sends.
 */
import type { Root } from "react-dom/client";
import { OpenAIRealtimeProvider } from "@khaveeai/providers-openai-realtime";
import { KhaveeProvider, VRMAvatar, GLBAvatar } from "@khaveeai/react";
import { Canvas } from "@react-three/fiber";
import { ClickToTalkOverlay } from "./ui/ClickToTalkOverlay";
import { ErrorOverlay } from "./ui/ErrorOverlay";

/**
 * Shape of the JSON object server-rendered into each mount point's
 * `data-khaveeai-config` attribute by AvatarRenderer::render() (plan 02/04).
 */
export interface KhaveeAvatarConfig {
  voice?:
    | "alloy"
    | "ash"
    | "ballad"
    | "coral"
    | "echo"
    | "sage"
    | "shimmer"
    | "verse"
    | "marin"
    | "cedar";
  instructions?: string;
  avatarUrl?: string;
  restUrl?: string;
}

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
