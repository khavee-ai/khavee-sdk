/**
 * packages/wp-bundle/src/ui/AvatarErrorBoundary.tsx
 *
 * Contains an uncaught GLB/VRM load failure (or WebGL context loss) to the
 * avatar Canvas ALONE, instead of letting it unmount the entire mount-point
 * React root (bugfix, quick task 260704-77n, found live against wp-env).
 *
 * Root cause: @react-three/fiber's <Canvas> wraps its own children in an
 * internal error boundary, but RE-THROWS any caught error on Canvas's own
 * NEXT render (`if (error) throw error;` in react-three-fiber's CanvasImpl —
 * see node_modules/@react-three/fiber/dist/react-three-fiber.cjs.dev.js).
 * The failure therefore propagates OUT of <Canvas> into whatever rendered
 * it. Without an Error Boundary somewhere ABOVE <Canvas> in THIS tree, that
 * uncaught render-phase throw crashes the entire react-dom root
 * mountAvatarInstance created for this mount point (React unmounts a root
 * on an uncaught render error when nothing catches it) — taking the chat
 * transcript, launcher, and every unrelated sibling down with it, even
 * though they have nothing to do with the avatar failure. Live-reproduced:
 * an S3-hosted avatar URL rejected by CORS on the localhost:8888 origin
 * (an accepted, out-of-scope environment limitation) triggered exactly this
 * — the FloatingWidget's entire mount point disappeared within ~5-10s with
 * zero user interaction.
 *
 * componentDidCatch normalizes the caught value to an Error (matches the
 * `error instanceof Error ? error : new Error(String(error))` convention
 * used throughout OpenAISTTTTSProvider.ts's own catch blocks) and forwards
 * it through realtimeProvider.onError — the SAME error-surfacing mechanism
 * ErrorOverlay already chains onto (CLAUDE.md Error Handling: "Errors are
 * surfaced to consumers exclusively through the optional onError?: (error:
 * Error) => void event callback"). ErrorOverlay is a SIBLING of this
 * boundary, not a descendant of the crashed Canvas, so it keeps rendering
 * and simply picks up the forwarded error with zero changes to
 * ErrorOverlay.tsx itself.
 */
import { Component, type ReactNode } from "react";
import { useKhavee } from "@khaveeai/react";

interface AvatarErrorBoundaryImplProps {
  children: ReactNode;
  /** Wired to realtimeProvider.onError by the AvatarErrorBoundary wrapper below. */
  onError?: (error: Error) => void;
}

interface AvatarErrorBoundaryImplState {
  hasError: boolean;
}

/**
 * Class component: React error boundaries (getDerivedStateFromError /
 * componentDidCatch) have no hook-based equivalent, so this must be a
 * class. Kept private (not exported) — callers use the AvatarErrorBoundary
 * function-component wrapper below, which resolves realtimeProvider via
 * useKhavee() and wires it in.
 */
class AvatarErrorBoundaryImpl extends Component<
  AvatarErrorBoundaryImplProps,
  AvatarErrorBoundaryImplState
> {
  state: AvatarErrorBoundaryImplState = { hasError: false };

  static getDerivedStateFromError(): AvatarErrorBoundaryImplState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    this.props.onError?.(
      error instanceof Error ? error : new Error(String(error))
    );
  }

  render(): ReactNode {
    // Render nothing in place of the crashed Canvas — every sibling
    // (ChatBox, ControlBar, the launcher button, ErrorOverlay) lives
    // OUTSIDE this boundary and keeps rendering/functioning normally.
    return this.state.hasError ? null : this.props.children;
  }
}

/**
 * AvatarErrorBoundary — wrap any AvatarScene usage in this so a GLB/VRM
 * load failure degrades to "no avatar, everything else still works" instead
 * of unmounting the whole widget. Used by both the inline AppRoot layout
 * (mount.tsx) and FloatingWidget.tsx.
 */
export function AvatarErrorBoundary({ children }: { children: ReactNode }) {
  const { realtimeProvider } = useKhavee();

  return (
    <AvatarErrorBoundaryImpl
      onError={(error) => realtimeProvider?.onError?.(error)}
    >
      {children}
    </AvatarErrorBoundaryImpl>
  );
}
