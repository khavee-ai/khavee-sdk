/**
 * blink.ts — Ref-driven procedural blink delta (D-01).
 *
 * This is an internal helper module and is NOT exported from index.ts.
 *
 * Migrated verbatim from `VRMAvatar.tsx` lines 308-317 (refs) and 516-553
 * (per-frame logic) — the timing constants, blink curve, and scheduling are
 * unchanged from the original inline implementation. The only behavioral
 * difference is that this module reads/writes through
 * `adapter.getExpressionManager()` instead of `currentVrm.expressionManager`
 * directly, so it becomes a no-op on GLB (whose adapter returns null) rather
 * than something only VRMAvatar could run. Blink writes expression
 * (blendshape) values only — it never touches bone quaternions, so it has no
 * interaction with the crossfade engine's pose-gap measurement (RESEARCH
 * Pitfall 6).
 */

import { useRef } from "react";
import type { AvatarFormatAdapter } from "./types";

/**
 * Ref-driven blink stepper. Call `useBlink()` once per component instance
 * and invoke the returned `step(adapter, enabled)` from inside the same
 * `useFrame` callback that updates the mixer, every frame.
 */
export function useBlink(): {
  step(adapter: AvatarFormatAdapter, enabled: boolean): void;
} {
  // Blinking system. blinkState is a ref, not React state: it's only ever
  // read synchronously within the same useFrame callback that writes it,
  // never rendered in JSX — calling a state setter here would re-render
  // this component on every single animation frame during a blink (blink
  // lasts ~7 frames at blinkAnimationRef's 0.15/frame step), fighting the
  // R3F render loop for the main thread and producing visible stutter.
  const blinkState = useRef(0);
  const nextBlinkTime = useRef(Date.now() + 2000 + Math.random() * 3000);
  const isBlinking = useRef(false);
  const blinkAnimationRef = useRef(0);

  function step(adapter: AvatarFormatAdapter, enabled: boolean): void {
    if (!enabled) return;

    const expressionManager = adapter.getExpressionManager();
    if (!expressionManager) return; // GLB (and any format with no expression system): automatic no-op.

    const time = Date.now();

    // Check if it's time to blink
    if (time > nextBlinkTime.current && !isBlinking.current) {
      isBlinking.current = true;
      blinkAnimationRef.current = 0;
      nextBlinkTime.current = time + 100 + Math.random() * 4000; // Next blink in 0-4 seconds
    }

    // Handle blink animation
    if (isBlinking.current) {
      blinkAnimationRef.current += 0.15;
      if (blinkAnimationRef.current >= 1) {
        isBlinking.current = false;
        blinkState.current = 0;
      } else {
        // Create smooth blink curve using sine
        blinkState.current = Math.sin(blinkAnimationRef.current * Math.PI);
      }
    }

    // Apply blinking to the expression system
    if (
      expressionManager.blinkExpressionNames.includes("blinkLeft") &&
      expressionManager.blinkExpressionNames.includes("blinkRight")
    ) {
      expressionManager.setValue("blinkLeft", blinkState.current);
      expressionManager.setValue("blinkRight", blinkState.current);
    }
  }

  return { step };
}
