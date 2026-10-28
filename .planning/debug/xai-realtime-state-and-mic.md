---
status: awaiting_human_verify
trigger: "xAI chat status sometimes switches thinking/listening until speech; mic toggle sometimes says Couldn't connect"
created: 2026-10-28
updated: 2026-10-28
---

## Current Focus
reasoning_checkpoint:
  hypothesis: Unmatched VAD events overwrite chat status; toggle reports success when mic engine is missing and rejects on capture errors.
  confirming_evidence:
    - speech_started and committed set status with no active-speech or mic guard.
    - toggleMicrophone returns true after enableMicrophone returns early without mic engine.
    - MicCaptureEngine.enable may reject from initialize or AudioContext.resume.
  falsification_test: Synthetic unmatched events leave status unchanged; missing or failing mic enable returns false without rejection.
  fix_rationale: Track active speech, ignore unmatched events, and derive toggle result from actual engine state.
  blind_spots: Intermittent live xAI event ordering requires human verification in browser.
next_action: User tests /xai with real mic and token endpoint, then reports whether status loop or mic error persists.

## Symptoms
expected: Stable ready/listening/thinking/speaking transitions; mic toggle reflects actual mic state and reports mic errors accurately.
actual: Thinking/listening repeats until user speaks; mic toggle sometimes displays Couldn't connect.
errors: "Couldn't connect" (UI wording, source unconfirmed).
reproduction: Intermittent during xAI voice conversation and mic toggle.
started: Unknown.

## Eliminated

## Evidence
- timestamp: 2026-10-28
  checked: XAIRealtimeProvider event handling
  found: speech_started, committed, and response.created change chatStatus unconditionally.
  implication: Late or unrelated events can overwrite current status.
- timestamp: 2026-10-28
  checked: toggleMicrophone and MicCaptureEngine
  found: toggle returns true after enableMicrophone even when no mic engine exists; enable can reject when getUserMedia or resume fails.
  implication: UI can report wrong mic state or receive rejected promise.
- timestamp: 2026-10-28
  checked: connect lifecycle
  found: onConnect fires before microphone initialization completes, enabling UI mic action during setup.
  implication: Mic toggle can race initial capture setup.
- timestamp: 2026-10-28
  checked: input_audio_buffer.speech_stopped
  found: Status remains listening until committed; no fallback if committed is absent.
  implication: A stalled event sequence leaves listening indefinitely.
- timestamp: 2026-10-28
  checked: WebSocket onclose
  found: Unexpected close changed status but left microphone and playback engines running.
  implication: Reconnect can leave stale capture resources and mic state.

## Resolution
root_cause: Provider trusts unmatched VAD events, lacks missing-commit recovery, announces connection before mic setup, and reports mic state from requested action rather than capture state.
fix: Track active speech, ignore duplicate/unmatched VAD events, recover from missing commit after 5s, delay onConnect until mic setup, clean engines on unexpected close, and return actual mic state with specific errors.
verification: Five synthetic provider tests pass via package test script; package TypeScript build passes. Real xAI browser run pending.
files_changed: [packages/providers/xai-realtime/src/XAIRealtimeProvider.ts, packages/providers/xai-realtime/src/__tests__/XAIRealtimeProvider.test.js, packages/providers/xai-realtime/package.json, pnpm-lock.yaml]
