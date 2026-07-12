/**
 * audioAmplitude.ts — speaking-only volume -> procedural amplitude scale (TALK-02).
 *
 * This is an internal helper module and is NOT exported from index.ts.
 *
 * Pure mapping only: `volumeToAmplitudeScale` scales procedural motion
 * AMPLITUDE while `speaking` — it must never influence clip selection or
 * cycle timing, which is `talkCycle.ts`'s independent responsibility. No
 * React, no refs, no side effects: same inputs always produce the same
 * output.
 *
 * The clamp mirrors `KhaveeProvider.tsx`'s `Math.max(0, Math.min(1, volume))`
 * convention used when `onVolumeChange` sets `currentVolume`. That clamp
 * already runs on ingest, but this module re-clamps as defense in depth
 * (T-11-04): a malformed/out-of-range volume value reaching this function by
 * any other path must never be able to drive extreme procedural motion.
 */

import type { ChatStatus } from "@khaveeai/core";

/** Gain applied to clamped volume: output ranges from 1 (neutral) to 1 + GAIN at full volume. */
const AMPLITUDE_GAIN = 1.25;

/**
 * Maps live volume to a procedural amplitude scale. Returns exactly 1
 * (neutral, no amplitude change) unless `chatStatus === "speaking"`.
 * While speaking, `currentVolume` is clamped into [0, 1] before mapping so
 * an out-of-range input can never produce an unbounded scale.
 */
export function volumeToAmplitudeScale(currentVolume: number, chatStatus: ChatStatus): number {
  if (chatStatus !== "speaking") {
    return 1;
  }

  const clampedVolume = Math.max(0, Math.min(1, currentVolume));
  return 1 + clampedVolume * AMPLITUDE_GAIN;
}
