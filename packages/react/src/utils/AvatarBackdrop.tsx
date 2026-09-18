import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  backdropLayout,
  type BackgroundFit,
  type BackdropLayout,
} from "./backdropCover";

/**
 * AvatarBackdrop - Graduated from spike 004 (backdrop-plane-dof).
 *
 * Renders a background inside the canvas as a plane at a finite distance,
 * reproducing CSS `background-size: cover` or `background-size: contain`
 * behavior across viewport resizes. Supports both flat colors and images.
 *
 * **Why a plane at finite distance, not `scene.background`:** Explicit distance
 * control is what makes depth of field tunable (D-06). `scene.background` sits
 * at maximum depth permanently, so DOF cannot separate it from the subject.
 *
 * **Canvas transparency:** Where the backdrop covers the canvas, it is no longer
 * transparent. This changes what a `preserveDrawingBuffer` screenshot contains
 * (T-16-17) — the screenshot will now include the background image.
 *
 * **CORS requirement:** The image host MUST send CORS headers. Without them,
 * `texImage2D` refuses the cross-origin image and the backdrop fails to load.
 * This is a real adoption constraint for khavee-app's storage/CDN (T-16-12).
 *
 * **Mount once per Canvas:** Multiple backdrops in the same scene are not
 * meaningful — only the nearest one would be visible anyway. Mount at most one
 * `<AvatarBackdrop>` per `<Canvas>`.
 */

/** Background source: flat color or image URL. */
export type AvatarBackground =
  | { type: "color"; value: string }
  | { type: "image"; url: string; fit?: BackgroundFit; distance?: number };

export interface AvatarBackdropProps {
  background: AvatarBackground;
  /** Reported on a rejected URL scheme, a failed/CORS-blocked load, or an oversized image. */
  onError?: (error: Error) => void;
}

// Re-export BackgroundFit so consumers need only one import site.
export type { BackgroundFit };

/** Allowlist of URL schemes safe to load as an image. */
const ALLOWED_SCHEMES = ["http:", "https:", "blob:", "data:"];

/**
 * Validate a URL against the allowlist and data: media-type constraint.
 * Returns null on valid, or an Error to report on invalid.
 */
function validateUrl(url: string): Error | null {
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    return new Error(`Invalid URL: ${url}`);
  }

  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    return new Error(
      `Unsupported URL scheme: ${parsed.protocol} (allowed: ${ALLOWED_SCHEMES.join(", ")})`,
    );
  }

  // data: URLs must have an image/ media type.
  if (parsed.protocol === "data:") {
    const match = /^data:([^;,]+)/.exec(url);
    if (!match || !match[1].startsWith("image/")) {
      return new Error(
        `data: URL must have an image/ media type, got: ${match?.[1] || "none"}`,
      );
    }
  }

  return null;
}

/** Maximum image dimensions (width * height) to prevent decode-bomb exhaustion (T-16-13). */
const MAX_MEGAPIXELS = 50_000_000;

export function AvatarBackdrop({
  background,
  onError,
}: AvatarBackdropProps): ReactElement | null {
  const { camera, size } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  const distance = background.type === "image" ? background.distance ?? 6 : 6;
  const fit = background.type === "image" ? background.fit ?? "cover" : "cover";

  // Kept in a ref so an inline callback — the ordinary way to pass one — does
  // not re-run the load effect on every parent render, disposing and
  // re-fetching the texture each time (CR-02).
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Owns the texture's GPU allocation: disposal follows the texture itself, so
  // it cannot run against a value the effect no longer holds.
  useEffect(() => {
    if (!texture) return;
    return () => texture.dispose();
  }, [texture]);

  // ── Load image texture ──
  useEffect(() => {
    if (background.type !== "image") {
      setTexture(null);
      return;
    }

    const { url } = background;
    // A slow earlier URL must not replace a newer one, and a load that lands
    // after unmount must not leak its texture (CR-03).
    let cancelled = false;

    // Validate URL scheme before attempting load (T-16-14).
    const validationError = validateUrl(url);
    if (validationError) {
      onError?.(validationError);
      return;
    }

    const loader = new THREE.TextureLoader();
    // Set crossOrigin to enable CORS for both readback and WebGL upload (T-16-12).
    // Spike 004: without CORS headers, texImage2D refuses the image.
    loader.setCrossOrigin("anonymous");

    loader.load(
      url,
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }

        // Reject oversized images to prevent GPU allocation exhaustion (T-16-13).
        const img = tex.image as HTMLImageElement;
        if (img.width * img.height > MAX_MEGAPIXELS) {
          const err = new Error(
            `Image too large: ${img.width}×${img.height} exceeds ${MAX_MEGAPIXELS} pixels`,
          );
          onErrorRef.current?.(err);
          tex.dispose();
          return;
        }

        // Spike 004: ClampToEdgeWrapping prevents the cropped edge from wrapping
        // around and reappearing on the opposite side under cover mode.
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;

        setTexture(tex);
      },
      undefined,
      (error) => {
        if (cancelled) return;
        const err =
          error instanceof Error ? error : new Error(String(error));
        onErrorRef.current?.(err);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [background.type === "image" ? background.url : null]);

  // ── Compute layout and apply to mesh ──
  useEffect(() => {
    if (!meshRef.current) return;

    const cam = camera as THREE.PerspectiveCamera;
    const cameraAspect = size.width / size.height;

    if (background.type === "color") {
      // Flat color has no aspect of its own — use the frustum aspect.
      const layout = backdropLayout({
        fovDegrees: cam.fov,
        cameraAspect,
        distance,
        imageAspect: cameraAspect,
        fit: "cover",
      });

      meshRef.current.scale.set(layout.planeWidth, layout.planeHeight, 1);
    } else if (background.type === "image" && texture) {
      // Image has its own aspect — compute cover/contain layout.
      const img = texture.image as HTMLImageElement;
      const imageAspect = img.width / img.height;

      const layout = backdropLayout({
        fovDegrees: cam.fov,
        cameraAspect,
        distance,
        imageAspect,
        fit,
      });

      // Apply texture repeat/offset for cover/contain cropping.
      texture.repeat.set(layout.repeat[0], layout.repeat[1]);
      texture.offset.set(layout.offset[0], layout.offset[1]);
      texture.needsUpdate = true;

      meshRef.current.scale.set(layout.planeWidth, layout.planeHeight, 1);
    }
  }, [
    camera,
    size.width,
    size.height,
    distance,
    fit,
    texture,
    background.type,
    background.type === "color" ? background.value : null,
  ]);

  // backdropLayout sizes the plane for `distance` from the camera, so the plane
  // must sit at that distance along the camera's view axis and face it. A fixed
  // world position only matches when the camera sits at the origin (spike 004's
  // original framing); with the camera at z=4 it rendered at ~60% size.
  // Reused per frame; allocating inside useFrame would churn GC.
  const scratch = useMemo(
    () => ({
      pos: new THREE.Vector3(),
      forward: new THREE.Vector3(),
      camQuat: new THREE.Quaternion(),
      parentQuat: new THREE.Quaternion(),
      parentInverse: new THREE.Matrix4(),
    }),
    [],
  );

  useFrame(({ camera: cam }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const { pos, forward, camQuat, parentQuat, parentInverse } = scratch;
    cam.getWorldPosition(pos);
    cam.getWorldDirection(forward);
    cam.getWorldQuaternion(camQuat);
    pos.addScaledVector(forward, distance);

    // The backdrop inherits every ancestor of the avatar component, and the
    // camera may itself be parented to a rig, so the world-space pose has to be
    // converted into the parent's space rather than copied straight across (CR-04).
    const parent = mesh.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      mesh.position
        .copy(pos)
        .applyMatrix4(parentInverse.copy(parent.matrixWorld).invert());
      mesh.quaternion.copy(
        parent.getWorldQuaternion(parentQuat).invert().multiply(camQuat),
      );
    } else {
      mesh.position.copy(pos);
      mesh.quaternion.copy(camQuat);
    }
  });

  // ── Render ──
  // Distinct keys force a remount when the type flips; reusing the material
  // would keep the previous image's `map` and tint it with the new colour.
  if (background.type === "color") {
    return (
      <mesh key="color" ref={meshRef}>
        <planeGeometry args={[1, 1]} />
        {/* Spike 004: meshBasicMaterial, not standard — the backdrop is an image,
            not a lit surface. Lighting it breaks its match to the source.
            toneMapped={false} prevents double-applying Phase 15's tone curve. */}
        <meshBasicMaterial
          color={background.value}
          toneMapped={false}
          depthWrite={true}
        />
      </mesh>
    );
  }

  if (background.type === "image" && texture) {
    return (
      <mesh key="image" ref={meshRef}>
        <planeGeometry args={[1, 1]} />
        {/* Spike 004: meshBasicMaterial + toneMapped={false} + ClampToEdgeWrapping.
            depthWrite={true} ensures the backdrop is visible to DOF (plan 16-03). */}
        <meshBasicMaterial
          map={texture}
          toneMapped={false}
          depthWrite={true}
        />
      </mesh>
    );
  }

  // No texture loaded yet, or error occurred.
  return null;
}
