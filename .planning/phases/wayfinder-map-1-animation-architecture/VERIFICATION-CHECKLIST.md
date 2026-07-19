# Verification Checklist — Natural Avatar Animation-State Architecture

Wayfinder ticket khavee-ai/khavee-sdk#14, part of map #1 ("Wayfinder: Natural avatar animation-state
architecture spec"). For use whenever this spec's decisions (#2-#13) are actually implemented — not
scoped to any specific execution session, since implementation is separate downstream work.

This is a curated, high-signal checklist, not one line per closed ticket. Items here are things an
ordinary code review or unmodified test suite would plausibly miss — subtle correctness details or
regressions of the exact "robotic" behaviors this map exists to fix. Restating every ticket's
decision here would dilute the signal.

---

## Objective checks (code-level facts, no judgment required)

- [ ] **Old patterns are actually gone.** `VRMAvatar.tsx` no longer has the `useEffect` +
      if-statement chatStatus→animation switching described in #2's "current state" note.
      `GLBAvatar.tsx` no longer has the `setTimeout`-driven loop-back-to-idle pattern described in
      #4. Both should route through the shared internal module from #8.
- [ ] **Pose-gap uses MAX, not average.** Per #5's key finding — a single dramatically-moved limb
      must drive the crossfade duration. Check the actual aggregation function: it should take the
      maximum per-bone angular distance across all animated bones, not an average. (#5's prototype
      literally demonstrated why average is wrong — a real regression risk if someone "simplifies"
      this during implementation.)
- [ ] **No live-clock interrupts in the speaking state.** Per #4 and #13 — talk-clip cycling switches
      on loop completion (with a minimum dwell floor), not a `setInterval`/`setTimeout`. Triggered
      semantic gestures (#13) queue for the next natural loop boundary rather than interrupting
      mid-clip. This is the single interrupt-free timing model the whole speaking state should
      follow — verify no new timer-driven interrupt got introduced anywhere in this state.
- [ ] **Zero-config gives full behavior.** Per #7 — a consumer mounting `<VRMAvatar src="..." />` or
      `<GLBAvatar src="..." />` with no `animations` prop at all should still get natural behavior
      across all 6 `ChatStatus` states, including the dedicated `starting`/`stopped` clips from #6 —
      not a degraded/partial fallback.
- [ ] **`animations` prop uses the reserved keys.** Per #7 — `ready`, `starting`, `listening`,
      `thinking`, `speaking`, `stopped` are the keys that drive automatic chatStatus behavior; other
      custom keys a consumer adds should still work for manual `animate(name)` calls, unchanged from
      today's behavior.
- [ ] **Procedural layer frame-time budget.** Per #10 — profile the actual frame-time cost of the
      combined procedural delta layer (breathing, sway, expression drift, audio-reactive amplitude,
      gaze, semantic gestures) against the synthesized ~1-2ms target. #10 was explicit that this
      number is reasoned, not benchmarked — treat it as a sanity check to catch a system that's
      wildly over budget, not a hard pass/fail gate.

## Subjective checks (human judgment, one reviewer, a running build)

For each `ChatStatus` state, a pass/fail judgment with a specific thing to watch for — not an
elaborate rubric.

- [ ] **`ready`** — Watch idle, undisturbed, for 30+ seconds. Does it read as alive (subtle
      breathing/sway, not perfectly still) without being distracting or twitchy?
- [ ] **`starting`** — Trigger a session start. Does the greeting read as a deliberate, complete
      moment — not clipped short, not instant-snap?
- [ ] **`listening`** — Does the avatar read as attentive, distinct from `ready`'s idle default —
      not just idle replayed under a different label?
- [ ] **`thinking`** — Does the gaze-aversion + posture actually read as "processing" to an outside
      observer, not just idle with a slightly different clip?
- [ ] **`speaking`** — Watch for 60+ seconds of continuous speech. Does talk-clip cycling ever look
      like it's on a visible, predictable timer? Does motion intensity feel connected to what's
      actually being said (louder/more emphatic moments vs. quiet ones)?
- [ ] **`stopped`** — Trigger a session end. Does the goodbye moment read as a deliberate close, not
      an abrupt cutoff?

---

Both sections should pass before considering an implementation to have delivered on this map's
destination. A failure in the objective section usually points to a specific, fixable code detail;
a failure in the subjective section is a signal to revisit the relevant ticket's decision (or the
asset backing it, per #9/#16) rather than to just tweak numbers blindly.
