/**
 * viseme.test.ts — unit tests for the hybrid-sourced, coarticulated viseme
 * channel and additive jaw motion (VIS-01..VIS-04, D-05..D-08).
 *
 * Timelines built below are hand-constructed `TimedPhoneme` fixtures
 * standing in for a real vendor timing response (RESEARCH Open Question 1)
 * — no TTS vendor wired in this repo emits phoneme timing today (RESEARCH
 * Pitfall 1).
 *
 * Stub `AvatarFormatAdapter` whose expression manager is backed by a `Map`,
 * mirroring `emotion.test.ts`'s stub-adapter convention.
 */

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  VISEME_KEYS,
  createVisemeChannel,
  createVisemeState,
  sampleTimeline,
  stepViseme,
  type TimedPhoneme,
  type VisemeChannel,
} from "./viseme";
import type { AvatarFormatAdapter } from "./types";

function makeStubExpressionManager(present: string[] = [...VISEME_KEYS]) {
  const values = new Map<string, number>();
  return {
    values,
    getExpression: (name: string) => (present.includes(name) ? {} : null),
    getValue: (name: string) => (values.has(name) ? values.get(name)! : 0),
    setValue: vi.fn((name: string, weight: number) => {
      values.set(name, weight);
    }),
  };
}

function makeStubAdapter(
  em: ReturnType<typeof makeStubExpressionManager> | null,
  jaw: THREE.Object3D | null = null,
): AvatarFormatAdapter {
  return {
    getMixer: () => {
      throw new Error("not used in this test");
    },
    getBoneNode: () => null,
    getHumanoidBoneNode: (role) => (role === "jaw" ? jaw : null),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getExpressionManager: () => em as any,
  };
}

function phoneme(
  ph: TimedPhoneme["phoneme"],
  timestamp: number,
  duration: number,
  intensity = 1,
): TimedPhoneme {
  return { phoneme: ph, intensity, timestamp, duration };
}

// ── VisemeChannel ─────────────────────────────────────────────────────────

describe("VisemeChannel.isActive / pushAnalysis", () => {
  it("starts inactive; a fresh analysis push activates it within CHANNEL_ACTIVE_WINDOW_MS (500ms)", () => {
    const channel = createVisemeChannel();
    expect(channel.isActive(0)).toBe(false);

    channel.pushAnalysis(phoneme("aa", 1000, 80), 1000);
    expect(channel.isActive(1400)).toBe(true);
    expect(channel.isActive(1600)).toBe(false);
  });
});

describe("VisemeChannel.pushTimed", () => {
  it("keeps entries sorted by timestamp regardless of push order", () => {
    const channel = createVisemeChannel();
    channel.pushTimed(phoneme("ou", 300, 100));
    channel.pushTimed(phoneme("aa", 0, 100));
    channel.pushTimed(phoneme("ee", 100, 100));

    expect(channel.timeline.map((e) => e.phoneme)).toEqual(["aa", "ee", "ou"]);
  });

  it("caps the timeline at MAX_TIMELINE_ENTRIES (256) by dropping the oldest", () => {
    const channel = createVisemeChannel();
    for (let i = 0; i < 1000; i++) {
      channel.pushTimed(phoneme("aa", i * 10, 10));
    }
    expect(channel.timeline.length).toBeLessThanOrEqual(256);
    // The most recent entry must survive the cap.
    expect(channel.timeline[channel.timeline.length - 1].timestamp).toBe(9990);
  });

  it("ignores entries with a non-finite timestamp", () => {
    const channel = createVisemeChannel();
    channel.pushTimed(phoneme("aa", NaN, 80));
    channel.pushTimed(phoneme("ih", Infinity, 80));
    expect(channel.timeline).toHaveLength(0);
  });
});

describe("VisemeChannel.clear", () => {
  it("empties both the timeline and the latest analysis sample", () => {
    const channel = createVisemeChannel();
    channel.pushTimed(phoneme("aa", 0, 80));
    channel.pushAnalysis(phoneme("ih", 0, 80), 0);

    channel.clear();

    expect(channel.timeline).toHaveLength(0);
    expect(channel.latestAnalysis).toBeNull();
  });
});

describe("VisemeChannel.hasTimingAt", () => {
  it("is true from first.timestamp - 50 through lastEnd + 250, false outside that window", () => {
    const channel = createVisemeChannel();
    channel.pushTimed(phoneme("aa", 1000, 100)); // [1000, 1100)
    channel.pushTimed(phoneme("ee", 1100, 100)); // [1100, 1200)

    expect(channel.hasTimingAt(1000 - 50)).toBe(true);
    expect(channel.hasTimingAt(1000 - 51)).toBe(false);
    expect(channel.hasTimingAt(1200 + 250)).toBe(true);
    expect(channel.hasTimingAt(1200 + 251)).toBe(false);
  });
});

// ── sampleTimeline (D-06 coarticulation) ─────────────────────────────────

describe("sampleTimeline", () => {
  // Fixture standing in for a real vendor timing response: aa[0,100) ->
  // ee[100,200) -> ou[200,300), contiguous, all intensity 1.
  function threePhonemeFixture(): TimedPhoneme[] {
    return [phoneme("aa", 0, 100), phoneme("ee", 100, 100), phoneme("ou", 200, 100)];
  }

  it("mid-segment (T+50) is dominated by the current phoneme", () => {
    const out = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    sampleTimeline(threePhonemeFixture(), 50, out);
    expect(out.aa).toBeGreaterThanOrEqual(0.7);
    expect(out.aa).toBeGreaterThan(out.ee);
  });

  it("at the exact boundary (T+100) both neighbors blend 50/50", () => {
    const out = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    sampleTimeline(threePhonemeFixture(), 100, out);
    expect(out.aa).toBeCloseTo(0.5, 1);
    expect(out.ee).toBeCloseTo(0.5, 1);
  });

  it("is continuous across the boundary (T+99.9 vs T+100.1 differ by < 0.02 per key)", () => {
    const before = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    const after = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    sampleTimeline(threePhonemeFixture(), 99.9, before);
    sampleTimeline(threePhonemeFixture(), 100.1, after);

    for (const key of VISEME_KEYS) {
      expect(Math.abs(before[key] - after[key])).toBeLessThan(0.02);
    }
  });

  it("anticipates lip-rounding: ou > 0 while ee is still current, close to the ou boundary", () => {
    const out = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    sampleTimeline(threePhonemeFixture(), 190, out);
    expect(out.ou).toBeGreaterThan(0);
  });

  it("keeps every key within [0, 1] across a scan of the fixture", () => {
    const timeline = threePhonemeFixture();
    for (let t = -20; t <= 320; t += 5) {
      const out = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
      sampleTimeline(timeline, t, out);
      for (const key of VISEME_KEYS) {
        expect(out[key]).toBeGreaterThanOrEqual(0);
        expect(out[key]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("treats a gap longer than MAX_CONTIGUOUS_GAP_MS (50ms) as silence at its midpoint", () => {
    const timeline = [phoneme("aa", 0, 100), phoneme("ou", 300, 100)]; // 200ms gap
    const out = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    sampleTimeline(timeline, 200, out); // gap midpoint

    for (const key of VISEME_KEYS) {
      expect(out[key]).toBeLessThan(0.05);
    }
  });
});

// ── stepViseme: hybrid selection (D-05) ──────────────────────────────────

describe("stepViseme — hybrid timing-vs-analysis selection (D-05)", () => {
  it("prefers timing over a simultaneously fresh analysis sample while the timeline covers now", () => {
    const em = makeStubExpressionManager();
    const adapter = makeStubAdapter(em);
    const state = createVisemeState();
    const channel = createVisemeChannel();

    channel.pushTimed(phoneme("aa", 0, 2000)); // covers [0, 2000)
    channel.pushAnalysis(phoneme("ou", 1000, 80), 1000);

    let now = 0;
    for (let i = 0; i < 20; i++) {
      stepViseme(state, { adapter, channel, nowMs: now, delta: 0.05 });
      now += 50;
    }

    expect(state.smoothed.aa).toBeGreaterThan(state.smoothed.ou);
  });

  it("falls back to the analysis path once the timeline plus its tail has fully ended", () => {
    const em = makeStubExpressionManager();
    const adapter = makeStubAdapter(em);
    const state = createVisemeState();
    const channel = createVisemeChannel();

    channel.pushTimed(phoneme("aa", 0, 2000)); // covers [0, 2000), tail ends at 2250

    let now = 0;
    for (let i = 0; i < 20; i++) {
      stepViseme(state, { adapter, channel, nowMs: now, delta: 0.05 });
      now += 50;
    }
    expect(state.smoothed.aa).toBeGreaterThan(0.5);

    // Past the timing tail: feed sustained fresh "ou" analysis.
    now = 2300;
    for (let i = 0; i < 15; i++) {
      channel.pushAnalysis(phoneme("ou", now, 80), now);
      stepViseme(state, { adapter, channel, nowMs: now, delta: 0.05 });
      now += 50;
    }

    expect(state.smoothed.ou).toBeGreaterThan(state.smoothed.aa);
  });
});

// ── stepViseme: analysis-path debounce + carryover (D-06 improved fallback) ─

describe("stepViseme — analysis-path debounce (D-06)", () => {
  it("never lets a single-frame flip exceed 0.1", () => {
    const em = makeStubExpressionManager();
    const adapter = makeStubAdapter(em);
    const state = createVisemeState();
    const channel = createVisemeChannel();

    let now = 0;
    for (let i = 0; i < 6; i++) {
      channel.pushAnalysis(phoneme("ou", now, 80), now);
      stepViseme(state, { adapter, channel, nowMs: now, delta: 0.05 });
      now += 50;
    }
    expect(state.dominantPhoneme).toBe("ou");

    // A single 16ms frame of "ee", then immediately back to "ou".
    channel.pushAnalysis(phoneme("ee", now, 80), now);
    stepViseme(state, { adapter, channel, nowMs: now, delta: 0.016 });
    now += 16;
    channel.pushAnalysis(phoneme("ou", now, 80), now);
    stepViseme(state, { adapter, channel, nowMs: now, delta: 0.016 });

    expect(state.smoothed.ee).toBeLessThan(0.1);
  });
});

describe("stepViseme — analysis-path carryover (D-06)", () => {
  it("keeps the previous viseme's influence briefly after a sustained switch, decaying below 0.01 well within 500ms", () => {
    const em = makeStubExpressionManager();
    const adapter = makeStubAdapter(em);
    const state = createVisemeState();
    const channel = createVisemeChannel();

    let now = 0;
    for (let i = 0; i < 6; i++) {
      channel.pushAnalysis(phoneme("ou", now, 80), now);
      stepViseme(state, { adapter, channel, nowMs: now, delta: 0.05 });
      now += 50;
    }
    expect(state.dominantPhoneme).toBe("ou");
    expect(state.smoothed.ou).toBeGreaterThan(0.3);

    let promoted = false;
    for (let i = 0; i < 6 && !promoted; i++) {
      channel.pushAnalysis(phoneme("ee", now, 80), now);
      stepViseme(state, { adapter, channel, nowMs: now, delta: 0.016 });
      now += 16;
      promoted = state.dominantPhoneme === "ee";
    }
    expect(promoted).toBe(true);

    // Immediately after promotion, the outgoing "ou" is still present.
    expect(state.smoothed.ou).toBeGreaterThan(0);

    // Sustain "ee" for well past the carryover decay window.
    for (let i = 0; i < 30; i++) {
      channel.pushAnalysis(phoneme("ee", now, 80), now);
      stepViseme(state, { adapter, channel, nowMs: now, delta: 0.02 });
      now += 20;
    }
    expect(state.smoothed.ou).toBeLessThan(0.01);
  });
});

describe("stepViseme — stale analysis (> ANALYSIS_STALE_MS)", () => {
  it("targets silence once the latest analysis sample is older than ANALYSIS_STALE_MS (60ms), and the mouth decays", () => {
    const em = makeStubExpressionManager();
    const adapter = makeStubAdapter(em);
    const state = createVisemeState();
    const channel = createVisemeChannel();

    channel.pushAnalysis(phoneme("aa", 0, 80), 0);

    let now = 0;
    for (let i = 0; i < 5; i++) {
      stepViseme(state, { adapter, channel, nowMs: now, delta: 0.03 });
      now += 30;
    }
    const smoothedBeforeStale = state.smoothed.aa;
    expect(smoothedBeforeStale).toBeGreaterThan(0.1);

    // Jump well past staleness with no new push.
    stepViseme(state, { adapter, channel, nowMs: 400, delta: 0.3 });
    expect(state.smoothed.aa).toBeLessThan(smoothedBeforeStale);
  });
});

// ── stepViseme: jaw motion (D-07/VIS-03) ─────────────────────────────────

describe("stepViseme — additive, non-accumulating, capped jaw motion (D-07/VIS-03)", () => {
  it("rotates the jaw down, capped at MAX_JAW_OPEN_DEG (10deg), and does not accumulate across frames", () => {
    const em = makeStubExpressionManager();
    const jaw = new THREE.Object3D();
    const adapter = makeStubAdapter(em, jaw);
    const state = createVisemeState();
    const channel = createVisemeChannel();

    // A very long timing entry, sampled well away from either edge so the
    // sampled target is pure "aa" at intensity 1 throughout.
    channel.pushTimed(phoneme("aa", 0, 1_000_000, 1));

    let now = 500_000;
    let angleAt100 = 0;
    for (let i = 1; i <= 200; i++) {
      stepViseme(state, { adapter, channel, nowMs: now, delta: 0.016 });
      now += 16;
      if (i === 100) {
        angleAt100 = jaw.quaternion.angleTo(new THREE.Quaternion());
      }
    }
    const angleAt200 = jaw.quaternion.angleTo(new THREE.Quaternion());

    const maxRad = THREE.MathUtils.degToRad(10);
    expect(angleAt200).toBeGreaterThan(0.05);
    expect(angleAt200).toBeLessThanOrEqual(maxRad + 1e-3);

    // Chin moves down: +Z (forward) rotates to a negative Y under the jaw delta.
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(jaw.quaternion);
    expect(forward.y).toBeLessThan(0);

    // No accumulation: the angle at frame 100 already matches frame 200's
    // steady-state value.
    expect(Math.abs(angleAt200 - angleAt100)).toBeLessThan(1e-4);
  });

  it("still writes mouth expression values when the adapter has no jaw bone", () => {
    const em = makeStubExpressionManager();
    const adapter = makeStubAdapter(em, null);
    const state = createVisemeState();
    const channel = createVisemeChannel();
    channel.pushTimed(phoneme("aa", 0, 1_000_000, 1));

    expect(() => {
      let now = 500_000;
      for (let i = 0; i < 10; i++) {
        stepViseme(state, { adapter, channel, nowMs: now, delta: 0.05 });
        now += 50;
      }
    }).not.toThrow();

    expect(em.setValue).toHaveBeenCalledWith("aa", expect.any(Number));
    expect(state.smoothed.aa).toBeGreaterThan(0.5);
  });
});

// ── stepViseme: ownership (D-08) ──────────────────────────────────────────

describe("stepViseme — ownership / coexistence with the legacy lip-sync path (D-08)", () => {
  it("makes zero setValue calls across 60 steps when the channel never receives a push", () => {
    const em = makeStubExpressionManager();
    const adapter = makeStubAdapter(em);
    const state = createVisemeState();
    const channel = createVisemeChannel();

    let now = 0;
    for (let i = 0; i < 60; i++) {
      const result = stepViseme(state, { adapter, channel, nowMs: now, delta: 0.016 });
      expect(result.owning).toBe(false);
      now += 16;
    }

    expect(em.setValue).not.toHaveBeenCalled();
  });

  it("writes zeros exactly once when data stops, then stops writing; the jaw returns to rest", () => {
    const em = makeStubExpressionManager();
    const jaw = new THREE.Object3D();
    const adapter = makeStubAdapter(em, jaw);
    const state = createVisemeState();
    const channel = createVisemeChannel();

    let now = 0;
    for (let i = 0; i < 10; i++) {
      channel.pushAnalysis(phoneme("aa", now, 80), now);
      stepViseme(state, { adapter, channel, nowMs: now, delta: 0.05 });
      now += 50;
    }
    expect(state.owning).toBe(true);
    expect(Math.max(state.smoothed.aa, state.smoothed.oh)).toBeGreaterThan(0.002);

    em.setValue.mockClear();

    // Data stops: no more pushes. A large jump + large delta makes the
    // existing analysis stale AND forces near-total decay in one step, so
    // this is the single frame where ownership is released.
    now += 5000;
    const releaseResult = stepViseme(state, { adapter, channel, nowMs: now, delta: 50 });
    expect(releaseResult.owning).toBe(false);
    expect(em.setValue).toHaveBeenCalled();
    const callsAtRelease = em.setValue.mock.calls.length;

    for (let i = 0; i < 30; i++) {
      now += 50;
      stepViseme(state, { adapter, channel, nowMs: now, delta: 0.05 });
    }

    expect(em.setValue.mock.calls.length).toBe(callsAtRelease);
    expect(jaw.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-3);
  });
});

describe("stepViseme — null expression manager (GLB)", () => {
  it("returns { owning: false } with no throw", () => {
    const adapter = makeStubAdapter(null);
    const state = createVisemeState();
    const channel: VisemeChannel = createVisemeChannel();
    channel.pushAnalysis(phoneme("aa", 0, 80), 0);

    let result;
    expect(() => {
      result = stepViseme(state, { adapter, channel, nowMs: 0, delta: 0.016 });
    }).not.toThrow();

    expect(result).toEqual({ owning: false, openness: 0 });
  });
});

// ── stepViseme: loudness envelope (analysis path) ───────────────────────

describe("VisemeChannel.pushLevel", () => {
  it("ignores non-finite values and is cleared by clear()", () => {
    const channel = createVisemeChannel();
    channel.pushLevel(Number.NaN, 0);
    expect(channel.latestLevel).toBeNull();
    channel.pushLevel(0.2, 0);
    expect(channel.latestLevel?.rms).toBe(0.2);
    channel.clear();
    expect(channel.latestLevel).toBeNull();
  });

  it("counts toward isActive only while audible and fresh — the level feed runs through silence", () => {
    const channel = createVisemeChannel();
    channel.pushLevel(0.001, 0);
    expect(channel.isActive(0)).toBe(false);
    channel.pushLevel(0.2, 10);
    expect(channel.isActive(10)).toBe(true);
    expect(channel.isActive(500)).toBe(false);
  });
});

describe("stepViseme — loudness envelope drives openness (analysis path)", () => {
  /**
   * Drives `durationMs` of frames at 60fps. The classifier keeps reporting the
   * same vowel every frame (as the real one does mid-sentence) while the
   * level follows the speech envelope.
   */
  function run(
    state: ReturnType<typeof createVisemeState>,
    adapter: AvatarFormatAdapter,
    channel: VisemeChannel,
    startMs: number,
    durationMs: number,
    rms: number | null,
    ph: TimedPhoneme["phoneme"] | null = "aa",
  ): number {
    const dt = 1000 / 60;
    let now = startMs;
    while (now < startMs + durationMs) {
      if (ph) channel.pushAnalysis(phoneme(ph, now, 50), now);
      if (rms !== null) channel.pushLevel(rms, now);
      stepViseme(state, { adapter, channel, nowMs: now, delta: dt / 1000 });
      now += dt;
    }
    return now;
  }

  it("opens on a syllable, closes in the gap, and reopens — even though the vowel never changes", () => {
    const adapter = makeStubAdapter(makeStubExpressionManager());
    const state = createVisemeState();
    const channel = createVisemeChannel();

    let now = run(state, adapter, channel, 0, 150, 0.15);
    expect(state.smoothed.aa).toBeGreaterThan(0.5);

    now = run(state, adapter, channel, now, 120, 0.002);
    expect(state.smoothed.aa).toBeLessThan(0.1);

    run(state, adapter, channel, now, 150, 0.15);
    expect(state.smoothed.aa).toBeGreaterThan(0.5);
  });

  it("does not hold the mouth open on a constant full-intensity vowel when the audio is silent", () => {
    const adapter = makeStubAdapter(makeStubExpressionManager());
    const state = createVisemeState();
    const channel = createVisemeChannel();

    run(state, adapter, channel, 0, 300, 0.001);
    expect(Math.max(...VISEME_KEYS.map((k) => state.smoothed[k]))).toBeLessThan(0.02);
  });

  it("opens less for a quieter syllable than for the recent loud peak", () => {
    const adapter = makeStubAdapter(makeStubExpressionManager());
    const state = createVisemeState();
    const channel = createVisemeChannel();

    let now = run(state, adapter, channel, 0, 200, 0.2);
    const loud = state.smoothed.aa;
    now = run(state, adapter, channel, now, 100, 0.002);
    run(state, adapter, channel, now, 200, 0.06);
    expect(state.smoothed.aa).toBeLessThan(loud * 0.75);
    expect(state.smoothed.aa).toBeGreaterThan(0.1);
  });

  it("never opens past MAX_ANALYSIS_OPEN (0.85), even at the loudest peak", () => {
    const adapter = makeStubAdapter(makeStubExpressionManager());
    const state = createVisemeState();
    const channel = createVisemeChannel();

    run(state, adapter, channel, 0, 400, 0.9);
    expect(state.smoothed.aa).toBeLessThanOrEqual(0.85 + 1e-6);
  });

  it("still opens with loud audio before any vowel has been classified", () => {
    const adapter = makeStubAdapter(makeStubExpressionManager());
    const state = createVisemeState();
    const channel = createVisemeChannel();

    run(state, adapter, channel, 0, 150, 0.15, null);
    expect(state.smoothed.aa).toBeGreaterThan(0.3);
  });

  it("returns the jaw toward rest in the gap between syllables", () => {
    const jaw = new THREE.Object3D();
    const adapter = makeStubAdapter(makeStubExpressionManager(), jaw);
    const state = createVisemeState();
    const channel = createVisemeChannel();
    const rest = new THREE.Quaternion();

    let now = run(state, adapter, channel, 0, 150, 0.15);
    const openAngle = jaw.quaternion.angleTo(rest);
    expect(openAngle).toBeGreaterThan(0.05);

    run(state, adapter, channel, now, 120, 0.002);
    expect(jaw.quaternion.angleTo(rest)).toBeLessThan(openAngle * 0.2);
  });
});
