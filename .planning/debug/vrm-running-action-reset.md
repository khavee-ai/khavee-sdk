---
status: awaiting_human_verify
trigger: "xAI conversation still flips listening/thinking; VRM randomly jiggles into T-pose and animation snaps; check whether xAI is cause"
created: 2026-10-28
updated: 2026-10-28
---

## Current Focus

reasoning_checkpoint:
  hypothesis: `beginCrossfade` calls reset() on an incoming AnimationAction that is still running at nonzero weight, forcing its time from 0.7 to 0 and abruptly changing the blended pose.
  confirming_evidence:
    - Installed three AnimationAction.reset() assigns time = 0.
    - A real AnimationMixer regression test with idle at time 0.7 and weight 0.4 fails: beginCrossfade(thinking, idle) leaves idle.time = 0.
  falsification_test: The same test would have passed before a fix if incoming time stayed 0.7; it fails exactly on action time.
  fix_rationale: Only reset the incoming action when it is not already running; a running action already owns a valid playback time and remains active through play().
  blind_spots: Live VRM visual effect and any separate pose snap causes remain unverified; xAI/app status loop is investigated separately by parent.
next_action: Validate the listening/thinking transition with the real VRM in the app; report whether any snap or T-pose remains.

## Symptoms

expected: VRM moves smoothly between clips during speech and thought changes.
actual: VRM intermittently jiggles toward T-pose or snaps during conversation while displayed status flips listening/thinking.
errors: None reported.
reproduction: Intermittent in khavee-app staging with xAI voice conversation.
started: Persists after xAI provider 0.1.8 release.

## Eliminated

## Evidence

- timestamp: 2026-10-28
  checked: khavee-app CharacterStage animation config
  found: No listening clip; listening resolves to manual idle_0, thinking resolves to a randomly selected thinking clip.
  implication: Every listening/thinking status switch can trigger a crossfade among clips with different poses.
- timestamp: 2026-10-28
  checked: crossfade.ts beginCrossfade and installed three AnimationAction.reset
  found: beginCrossfade captures incoming action's nonzero effective weight when running, then unconditionally calls reset(); three reset sets action time to zero.
  implication: An incoming clip that was still fading out jumps to its first frame while still affecting the skeleton.
- timestamp: 2026-10-28
  checked: Real AnimationMixer regression test in crossfade.test.ts
  found: beginCrossfade(thinking, idle) changes running idle clip time from 0.7 to 0 while it retains 0.4 weight; test fails before fix.
  implication: Mechanism is reproduced without xAI or app status code.
- timestamp: 2026-10-28
  checked: Focused regression test after conditional reset
  found: The same test passes; incoming action preserves time 0.7 and weight 0.4.
  implication: The demonstrated snap mechanism is removed.
- timestamp: 2026-10-28
  checked: React package test suite, TypeScript build, and diff whitespace check
  found: 346/346 tests pass, `pnpm --filter @khaveeai/react build` succeeds, and `git diff --check` is clean.
  implication: No detected regression in package checks; live VRM workflow still needs visual validation.

## Resolution

root_cause: beginCrossfade unconditionally restarts a nonzero-weight running incoming action, producing an abrupt pose change on rapid clip reversals.
fix: Skip reset() when the incoming action is already running; retain reset() for stopped/new actions.
verification: Reproduction test changed from red to green; 346 React package tests and TypeScript build pass. Real VRM visual verification pending.
files_changed: [packages/react/src/animation/crossfade.ts, packages/react/src/animation/crossfade.test.ts]
