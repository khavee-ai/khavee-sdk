/**
 * viseme.ts — hybrid-sourced (vendor timing + audio-analysis fallback),
 * coarticulated mouth-shape channel with additive jaw motion
 * (VIS-01..VIS-04, D-05..D-08, Phase 18 Plan 03).
 *
 * This is an internal helper module and is NOT exported from index.ts.
 *
 * Hybrid rule (D-05): whenever the channel's timing timeline covers `now`
 * (`hasTimingAt`), the coarticulated `sampleTimeline` sample wins — vendor
 * timing is the authoritative, most-accurate source. Otherwise, if a fresh
 * (<= ANALYSIS_STALE_MS old) audio-analysis sample exists, the debounced
 * analysis path drives the mouth. With neither, the target is silence.
 *
 * Ownership (D-08): the mouth is written ONLY while `channel.isActive(now)`
 * is true, or while releasing a still-nonzero smoothed value back toward
 * zero. A channel that is never pushed to makes zero `setValue` calls, just
 * like before this module existed — so the legacy `useAudioLipSync` ->
 * `setMultipleExpressions` -> `VRMAvatar` lerp path keeps working untouched
 * for any consumer that never wires this channel up.
 *
 * Timing timestamps are ALWAYS absolute `performance.now()`-clock
 * milliseconds (see `packages/core/src/types/audio.ts`'s `PhonemeData.source`
 * doc) — adapters are responsible for converting vendor-relative offsets.
 *
 * RESEARCH Pitfall 1: no TTS vendor wired anywhere in this repo emits
 * phoneme/word timing today. The timing path (`sampleTimeline`, `pushTimed`,
 * `hasTimingAt`) is therefore proven exclusively via hand-constructed
 * `TimedPhoneme` fixtures in `viseme.test.ts`, standing in for a real vendor
 * response (RESEARCH Open Question 1) — it is real, tested code, just not
 * yet exercised end-to-end with a live vendor. The audio-analysis path is
 * the one this phase visibly improves in the demo.
 *
 * Packaging note: `packages/react` resolves `@khaveeai/core` from the
 * published npm 0.1.5, NOT the workspace build, so this module imports only
 * `PhonemeData`/`MouthState` (both already exist in 0.1.5) and defines the
 * new optional timing fields locally as `TimedPhoneme` instead of relying on
 * this plan's `audio.ts` core change reaching react at runtime.
 */

import { useRef } from "react";
import * as THREE from "three";
import type { PhonemeData, MouthState } from "@khaveeai/core";
import { createAdditiveBoneSlot, applyAdditiveDelta, type AdditiveBoneSlot } from "./additiveBone";
import type { AvatarFormatAdapter } from "./types";

// ── Local timing type (packaging note above; RESEARCH Pitfall 6: no
//    parallel VisemeEvent/VisemeData type — this just extends PhonemeData) ──

/**
 * `PhonemeData` plus the Phase 18 timing fields that exist in core's
 * workspace `audio.ts` but are not yet in the published npm 0.1.5 this
 * package resolves at runtime. Structurally identical to core's extended
 * `PhonemeData` once core is republished.
 */
export type TimedPhoneme = PhonemeData & {
  source?: "timing" | "audio-analysis";
  wordBoundary?: boolean;
  duration?: number;
};

export const VISEME_KEYS = ["aa", "ih", "ou", "ee", "oh"] as const;
type VisemeKey = (typeof VISEME_KEYS)[number];

// ── Tunable constants ─────────────────────────────────────────────────────

const DEFAULT_TIMED_DURATION_MS = 80;
const MAX_TIMELINE_ENTRIES = 256;
const CHANNEL_ACTIVE_WINDOW_MS = 500;
const TIMING_LEAD_MS = 50;
const TIMING_TAIL_MS = 250;
const MAX_CONTIGUOUS_GAP_MS = 50;
const COART_EDGE = 0.35;
const ANTICIPATION_MS = 120;
const ANALYSIS_STALE_MS = 150;
const ANALYSIS_MIN_HOLD_MS = 40;
const COART_CARRYOVER_WEIGHT = 0.3;
const COART_CARRYOVER_DECAY_MS = 80;
const RELEASE_EPSILON = 0.002;
const MAX_JAW_OPEN_DEG = 10;

const TIMING_ATTACK_S = 0.02;
const TIMING_RELEASE_S = 0.05;
const ANALYSIS_ATTACK_S = 0.035;
const ANALYSIS_RELEASE_S = 0.09;

// ── Mouth-state helpers ───────────────────────────────────────────────────

function zeroMouthState(): MouthState {
  return { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
}

// Plain (non-frozen) shared zero constant — read-only by convention, never
// mutated. Kept as a plain MouthState (not Readonly<MouthState>) so it can
// be passed anywhere a MouthState is expected without a variance mismatch.
const ZERO_MOUTH: MouthState = zeroMouthState();

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Viseme shape table: phoneme -> full MouthState at intensity 1 (Claude's Discretion, recorded per plan). */
export const VISEME_SHAPES: Record<PhonemeData["phoneme"], MouthState> = {
  aa: { aa: 1, ih: 0, ou: 0, ee: 0, oh: 0.15 },
  ih: { aa: 0, ih: 1, ou: 0, ee: 0.2, oh: 0 },
  ou: { aa: 0, ih: 0, ou: 1, ee: 0, oh: 0.2 },
  ee: { aa: 0, ih: 0.2, ou: 0, ee: 1, oh: 0 },
  oh: { aa: 0.15, ih: 0, ou: 0.1, ee: 0, oh: 1 },
  sil: { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 },
};

/** shape(phoneme) x clamp01(intensity). Unknown/hostile phoneme values fall back to sil (T-18-07). */
export function timedToMouthTarget(p: TimedPhoneme): MouthState {
  const shape = VISEME_SHAPES[p.phoneme] ?? VISEME_SHAPES.sil;
  const intensity = clamp01(p.intensity);
  return {
    aa: shape.aa * intensity,
    ih: shape.ih * intensity,
    ou: shape.ou * intensity,
    ee: shape.ee * intensity,
    oh: shape.oh * intensity,
  };
}

// ── Audio-analysis loudness curve (ported verbatim from useRealtime.ts's
//    phonemeToMouthState — do not change these constants without also
//    checking useRealtime.ts's legacy fallback still matches by eye) ──────

const PHONEME_BOOSTS: Record<VisemeKey, number> = { aa: 2.2, ih: 1.8, ou: 2.0, ee: 1.7, oh: 1.9 };
const MIN_MOVEMENT: Record<VisemeKey, number> = { aa: 0.25, ih: 0.15, ou: 0.2, ee: 0.15, oh: 0.18 };
const SECONDARY_BLEND: Record<VisemeKey, VisemeKey> = { aa: "oh", ih: "ee", ou: "oh", ee: "ih", oh: "aa" };

/** Client-side spectral-classifier fallback shape, verbatim-ported constants (D-05 fallback). */
export function analysisToMouthTarget(p: TimedPhoneme, multiplier = 6.0): MouthState {
  const out = zeroMouthState();
  const phoneme = p.phoneme;
  if (phoneme === "sil" || !(VISEME_KEYS as readonly string[]).includes(phoneme) || p.intensity <= 0.01) {
    return out;
  }
  const key = phoneme as VisemeKey;
  let boosted = p.intensity * multiplier;
  boosted *= PHONEME_BOOSTS[key];
  boosted *= 1.8;
  boosted = Math.pow(boosted, 0.7);
  boosted = Math.min(boosted, 1.0);
  const finalIntensity = Math.max(boosted, MIN_MOVEMENT[key]);
  out[key] = finalIntensity;
  out[SECONDARY_BLEND[key]] = finalIntensity * 0.15;
  return out;
}

// ── VisemeChannel: plain mutable event sink (never React state) ─────────

/**
 * Holds the raw viseme event stream feeding one avatar instance. Deliberately
 * a plain mutable object rather than React state — 80Hz analyzer pushes must
 * never trigger a re-render (mirrors `gaze.ts`/`eyeGaze.ts` state objects).
 */
export class VisemeChannel {
  readonly timeline: TimedPhoneme[] = [];
  latestAnalysis: { phoneme: TimedPhoneme; receivedAtMs: number } | null = null;

  /** Records the latest audio-analysis sample, replacing any previous one. */
  pushAnalysis(phoneme: TimedPhoneme, nowMs: number): void {
    this.latestAnalysis = { phoneme, receivedAtMs: nowMs };
  }

  /**
   * Inserts a vendor timing event in sorted-by-timestamp order. Non-finite
   * timestamps are rejected (T-18-06). Hard-capped at `MAX_TIMELINE_ENTRIES`
   * by dropping the oldest (T-18-06).
   */
  pushTimed(phoneme: TimedPhoneme): void {
    if (!Number.isFinite(phoneme.timestamp)) return;
    const entry: TimedPhoneme = { ...phoneme, duration: phoneme.duration ?? DEFAULT_TIMED_DURATION_MS };
    let idx = this.timeline.length;
    while (idx > 0 && this.timeline[idx - 1].timestamp > entry.timestamp) idx--;
    this.timeline.splice(idx, 0, entry);
    if (this.timeline.length > MAX_TIMELINE_ENTRIES) {
      this.timeline.shift();
    }
  }

  /** Empties both the timing timeline and the latest analysis sample. */
  clear(): void {
    this.timeline.length = 0;
    this.latestAnalysis = null;
  }

  /** Drops timeline entries that ended more than 1s before `nowMs` (T-18-06). */
  prune(nowMs: number): void {
    const cutoff = nowMs - 1000;
    while (this.timeline.length > 0) {
      const first = this.timeline[0];
      const end = first.timestamp + (first.duration ?? DEFAULT_TIMED_DURATION_MS);
      if (end < cutoff) {
        this.timeline.shift();
      } else {
        break;
      }
    }
  }

  /** True when either a fresh analysis sample or timing data covers `nowMs`. */
  isActive(nowMs: number): boolean {
    const analysisActive =
      this.latestAnalysis !== null && nowMs - this.latestAnalysis.receivedAtMs <= CHANNEL_ACTIVE_WINDOW_MS;
    return analysisActive || this.hasTimingAt(nowMs);
  }

  /** True from `first.timestamp - TIMING_LEAD_MS` through `lastEnd + TIMING_TAIL_MS`. */
  hasTimingAt(nowMs: number): boolean {
    if (this.timeline.length === 0) return false;
    const first = this.timeline[0];
    const last = this.timeline[this.timeline.length - 1];
    const lastEnd = last.timestamp + (last.duration ?? DEFAULT_TIMED_DURATION_MS);
    return nowMs >= first.timestamp - TIMING_LEAD_MS && nowMs <= lastEnd + TIMING_TAIL_MS;
  }
}

export function createVisemeChannel(): VisemeChannel {
  return new VisemeChannel();
}

// ── sampleTimeline: coarticulation (D-06) ────────────────────────────────

/**
 * Walks forward from `(chainStartIdx, chainStartEnd)` through mutually
 * contiguous timeline entries (gap <= MAX_CONTIGUOUS_GAP_MS between each
 * consecutive pair) looking for the nearest upcoming "ou"/"oh" entry within
 * ANTICIPATION_MS of `nowMs`.
 *
 * This is a CHAINED lookahead rather than a single-neighbor check so the
 * boost is continuous across an earlier, shorter boundary: e.g. with
 * aa[0,100) -> ee[100,200) -> ou[200,300) all contiguous and
 * ANTICIPATION_MS (120) longer than ee's own 100ms duration, a
 * next-neighbor-only check would turn the boost on abruptly the instant
 * `now` crosses into the ee segment (ee's immediate next IS ou), while
 * being one tick earlier (still in aa, whose immediate next is ee, not
 * ou) would see no boost at all — a real discontinuity at the aa/ee
 * boundary. Chaining past intermediate non-ou/oh entries (as long as they
 * stay contiguous) fixes this: the same upcoming ou entry is found and the
 * same distance-based boost applies on both sides of the aa/ee boundary.
 * A real pause (gap > MAX_CONTIGUOUS_GAP_MS anywhere in the chain) stops
 * the walk — anticipation must never bleed across genuine silence.
 */
function findAnticipationBoost(
  timeline: TimedPhoneme[],
  nowMs: number,
  chainStartIdx: number,
  chainStartEnd: number,
): { boost: number; target: MouthState } | null {
  let idx = chainStartIdx;
  let boundaryEnd = chainStartEnd;

  while (true) {
    const nextIdx = idx + 1;
    if (nextIdx >= timeline.length) return null;
    const next = timeline[nextIdx];
    if (next.timestamp - boundaryEnd > MAX_CONTIGUOUS_GAP_MS) return null; // real gap: stop the chain

    if (next.phoneme === "ou" || next.phoneme === "oh") {
      const timeToBoundary = next.timestamp - nowMs;
      if (timeToBoundary >= 0 && timeToBoundary < ANTICIPATION_MS) {
        return { boost: 0.3 * (1 - timeToBoundary / ANTICIPATION_MS), target: timedToMouthTarget(next) };
      }
      return null;
    }

    idx = nextIdx;
    boundaryEnd = next.timestamp + (next.duration ?? DEFAULT_TIMED_DURATION_MS);
  }
}

/**
 * Samples the coarticulated mouth shape at `nowMs` from a sorted timing
 * timeline, writing into (and returning) `out`. Blends the current entry
 * with its immediate neighbors across a `COART_EDGE`-wide window at each
 * boundary (continuous — a 50/50 blend exactly at the boundary), only when
 * the neighbor is contiguous within `MAX_CONTIGUOUS_GAP_MS`. A real pause
 * (gap wider than `MAX_CONTIGUOUS_GAP_MS`) is pure silence with no blending.
 * Also applies a short lip-rounding anticipation boost when the next entry
 * is "ou"/"oh" and within `ANTICIPATION_MS` of the boundary.
 */
export function sampleTimeline(timeline: TimedPhoneme[], nowMs: number, out: MouthState): MouthState {
  out.aa = 0;
  out.ih = 0;
  out.ou = 0;
  out.ee = 0;
  out.oh = 0;

  if (timeline.length === 0) return out;

  let curIdx = -1;
  for (let i = 0; i < timeline.length; i++) {
    const start = timeline[i].timestamp;
    const end = start + (timeline[i].duration ?? DEFAULT_TIMED_DURATION_MS);
    if (nowMs >= start && nowMs < end) {
      curIdx = i;
      break;
    }
    if (start > nowMs) break; // sorted — no match possible past this point
  }

  let curStart: number;
  let curEnd: number;
  let prevEntry: TimedPhoneme | null = null;
  let nextEntry: TimedPhoneme | null = null;
  let curEntry: TimedPhoneme | null = null;
  // Index/end-time the lip-rounding anticipation lookahead chain starts
  // walking forward from (see findAnticipationBoost below) — always the
  // index whose OWN end is `curEnd` in the current-entry case, or the
  // bridging "before" entry's index in the gap case.
  let chainStartIdx: number;
  let chainStartEnd: number;

  if (curIdx >= 0) {
    curEntry = timeline[curIdx];
    curStart = curEntry.timestamp;
    curEnd = curStart + (curEntry.duration ?? DEFAULT_TIMED_DURATION_MS);
    chainStartIdx = curIdx;
    chainStartEnd = curEnd;

    if (curIdx > 0) {
      const p = timeline[curIdx - 1];
      const pEnd = p.timestamp + (p.duration ?? DEFAULT_TIMED_DURATION_MS);
      if (curStart - pEnd <= MAX_CONTIGUOUS_GAP_MS) prevEntry = p;
    }
    if (curIdx < timeline.length - 1) {
      const n = timeline[curIdx + 1];
      if (n.timestamp - curEnd <= MAX_CONTIGUOUS_GAP_MS) nextEntry = n;
    }
  } else {
    // `now` falls in a gap (or before-first/after-last).
    let beforeIdx = -1;
    for (let i = 0; i < timeline.length; i++) {
      const end = timeline[i].timestamp + (timeline[i].duration ?? DEFAULT_TIMED_DURATION_MS);
      if (end <= nowMs) beforeIdx = i;
      else break;
    }
    const afterIdx = beforeIdx + 1 < timeline.length ? beforeIdx + 1 : -1;
    const before = beforeIdx >= 0 ? timeline[beforeIdx] : null;
    const after = afterIdx >= 0 ? timeline[afterIdx] : null;

    if (!before || !after) return out; // before-first / after-last: pure silence.

    const beforeEnd = before.timestamp + (before.duration ?? DEFAULT_TIMED_DURATION_MS);
    const afterStart = after.timestamp;
    if (afterStart - beforeEnd > MAX_CONTIGUOUS_GAP_MS) return out; // real pause: pure silence.

    curStart = beforeEnd;
    curEnd = afterStart;
    prevEntry = before;
    nextEntry = after;
    chainStartIdx = beforeIdx;
    chainStartEnd = beforeEnd;
  }

  const span = Math.max(curEnd - curStart, 1e-6);
  const progress = Math.min(Math.max((nowMs - curStart) / span, 0), 1);

  let wPrev = 0;
  let wNext = 0;
  if (prevEntry && progress < COART_EDGE) {
    wPrev = 0.25 * (1 + Math.cos((Math.PI * progress) / COART_EDGE));
  }
  if (nextEntry && progress > 1 - COART_EDGE) {
    wNext = 0.25 * (1 + Math.cos((Math.PI * (1 - progress)) / COART_EDGE));
  }
  const wCur = 1 - wPrev - wNext;

  const prevTarget = prevEntry ? timedToMouthTarget(prevEntry) : ZERO_MOUTH;
  const curTarget = curEntry ? timedToMouthTarget(curEntry) : ZERO_MOUTH;
  const nextTarget = nextEntry ? timedToMouthTarget(nextEntry) : ZERO_MOUTH;

  for (const key of VISEME_KEYS) {
    out[key] = wPrev * prevTarget[key] + wCur * curTarget[key] + wNext * nextTarget[key];
  }

  // Rounding anticipation (D-06): approaching an upcoming "ou"/"oh" entry,
  // chained forward through contiguous entries (not just the immediate
  // neighbor) so the boost ramps in continuously BEFORE the immediately
  // preceding short segment even begins — see findAnticipationBoost's doc.
  const anticipation = findAnticipationBoost(timeline, nowMs, chainStartIdx, chainStartEnd);
  if (anticipation) {
    out.ou += anticipation.boost * anticipation.target.ou;
    out.oh += anticipation.boost * anticipation.target.oh;
  }

  for (const key of VISEME_KEYS) {
    out[key] = clamp01(out[key]);
  }

  return out;
}

// ── VisemeState + stepViseme: hybrid selection, debounce, jaw (D-05..D-08) ─

export interface VisemeState {
  smoothed: MouthState;
  owning: boolean;
  dominantPhoneme: VisemeKey | "sil";
  dominantTarget: MouthState;
  candidatePhoneme: VisemeKey | "sil" | null;
  candidateSinceMs: number | null;
  carryover: MouthState;
  carryoverAgeMs: number;
  jawSlot: AdditiveBoneSlot;
}

export function createVisemeState(): VisemeState {
  return {
    smoothed: zeroMouthState(),
    owning: false,
    dominantPhoneme: "sil",
    dominantTarget: zeroMouthState(),
    candidatePhoneme: null,
    candidateSinceMs: null,
    carryover: zeroMouthState(),
    carryoverAgeMs: 0,
    jawSlot: createAdditiveBoneSlot(),
  };
}

export interface VisemeStepParams {
  adapter: AvatarFormatAdapter;
  channel: VisemeChannel | null;
  nowMs: number;
  delta: number;
}

export interface VisemeStepResult {
  owning: boolean;
  openness: number;
}

// Module-scoped scratch objects reused every step call — never `new` inside
// the per-frame path (matches gesture.ts's `_scratchGesture` convention).
// Safe to share across every useViseme() instance because JS is single
// threaded and step() calls never interleave.
const _targetScratch: MouthState = zeroMouthState();
const JAW_AXIS = new THREE.Vector3(1, 0, 0);
const MAX_JAW_OPEN_RAD = THREE.MathUtils.degToRad(MAX_JAW_OPEN_DEG);
const _jawDelta = new THREE.Quaternion();

function computeOpenness(mouth: MouthState): number {
  const raw = mouth.aa * 1 + mouth.oh * 0.75 + mouth.ee * 0.5 + mouth.ou * 0.35 + mouth.ih * 0.3;
  return clamp01(raw);
}

/** Applies the additive, non-accumulating, capped jaw delta (VIS-03/D-07). Never throws on a missing jaw bone. */
function applyJaw(adapter: AvatarFormatAdapter, state: VisemeState, mouth: MouthState): number {
  const openness = computeOpenness(mouth);
  const angleRad = MAX_JAW_OPEN_RAD * Math.pow(openness, 0.85);
  _jawDelta.setFromAxisAngle(JAW_AXIS, angleRad);
  const jaw = adapter.getHumanoidBoneNode("jaw");
  if (jaw) {
    applyAdditiveDelta(jaw, state.jawSlot, _jawDelta);
  }
  return openness;
}

/**
 * Advances the viseme channel by one frame: selects timing-vs-analysis
 * (hybrid, D-05), smooths asymmetrically (attack/release), writes the
 * result onto the adapter's mouth-viseme expressions plus an additive jaw
 * delta, and yields ownership entirely once released (D-08).
 *
 * Mutates `state` in place. Never throws.
 */
export function stepViseme(state: VisemeState, params: VisemeStepParams): VisemeStepResult {
  const { adapter, channel, nowMs, delta } = params;

  const em = adapter.getExpressionManager();
  if (!em) {
    return { owning: false, openness: 0 };
  }

  channel?.prune(nowMs);

  let attackS = ANALYSIS_ATTACK_S;
  let releaseS = ANALYSIS_RELEASE_S;

  if (channel && channel.hasTimingAt(nowMs)) {
    sampleTimeline(channel.timeline, nowMs, _targetScratch);
    attackS = TIMING_ATTACK_S;
    releaseS = TIMING_RELEASE_S;
  } else if (channel && channel.latestAnalysis && nowMs - channel.latestAnalysis.receivedAtMs <= ANALYSIS_STALE_MS) {
    const latest = channel.latestAnalysis.phoneme;
    const latestKey: VisemeKey | "sil" = (VISEME_KEYS as readonly string[]).includes(latest.phoneme)
      ? (latest.phoneme as VisemeKey)
      : "sil";

    if (latestKey === state.dominantPhoneme) {
      // Same as dominant — refresh the dominant target from the newest
      // sample and cancel any stale candidate.
      state.candidatePhoneme = null;
      state.candidateSinceMs = null;
      state.dominantTarget = analysisToMouthTarget(latest);
    } else {
      // Debounce (D-06 improved fallback): a differing phoneme becomes the
      // candidate and is only promoted after ANALYSIS_MIN_HOLD_MS.
      if (state.candidatePhoneme !== latestKey) {
        state.candidatePhoneme = latestKey;
        state.candidateSinceMs = nowMs;
      }
      const heldMs = state.candidateSinceMs !== null ? nowMs - state.candidateSinceMs : 0;
      if (heldMs >= ANALYSIS_MIN_HOLD_MS) {
        state.carryover = { ...state.dominantTarget };
        state.carryoverAgeMs = 0;
        state.dominantPhoneme = latestKey;
        state.dominantTarget = analysisToMouthTarget(latest);
        state.candidatePhoneme = null;
        state.candidateSinceMs = null;
      }
    }

    // Decaying carryover influence of the previous viseme (D-06).
    state.carryoverAgeMs += delta * 1000;
    const c = COART_CARRYOVER_WEIGHT * Math.exp(-state.carryoverAgeMs / COART_CARRYOVER_DECAY_MS);
    for (const key of VISEME_KEYS) {
      _targetScratch[key] = state.dominantTarget[key] * (1 - c) + state.carryover[key] * c;
    }
  } else {
    _targetScratch.aa = 0;
    _targetScratch.ih = 0;
    _targetScratch.ou = 0;
    _targetScratch.ee = 0;
    _targetScratch.oh = 0;
  }

  // Asymmetric attack/release smoothing.
  for (const key of VISEME_KEYS) {
    const t = _targetScratch[key];
    const s = state.smoothed[key];
    const tau = t > s ? attackS : releaseS;
    const alpha = 1 - Math.exp(-delta / tau);
    state.smoothed[key] = s + (t - s) * alpha;
  }

  const active = channel?.isActive(nowMs) ?? false;
  const maxSmoothed = Math.max(
    state.smoothed.aa,
    state.smoothed.ih,
    state.smoothed.ou,
    state.smoothed.ee,
    state.smoothed.oh,
  );
  const owning = active || maxSmoothed > RELEASE_EPSILON;

  let openness = 0;
  if (owning) {
    for (const key of VISEME_KEYS) {
      if (em.getExpression(key) !== null) {
        em.setValue(key, clamp01(state.smoothed[key]));
      }
    }
    openness = applyJaw(adapter, state, state.smoothed);
  } else if (state.owning) {
    // Yield ownership: write zeros exactly once, then stop writing (D-08).
    for (const key of VISEME_KEYS) {
      if (em.getExpression(key) !== null) {
        em.setValue(key, 0);
      }
    }
    openness = applyJaw(adapter, state, ZERO_MOUTH);
  }

  state.owning = owning;

  return { owning, openness };
}

/**
 * Ref-driven viseme stepper. Call `useViseme()` once per component instance
 * and invoke the returned `step(params)` from inside the same
 * `useFrame`/`update(delta)` callback the other procedural systems use.
 */
export function useViseme(): { step(params: VisemeStepParams): VisemeStepResult } {
  const stateRef = useRef<VisemeState>(createVisemeState());

  function step(params: VisemeStepParams): VisemeStepResult {
    return stepViseme(stateRef.current, params);
  }

  return { step };
}
