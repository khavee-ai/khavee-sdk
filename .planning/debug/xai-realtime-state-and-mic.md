---
status: awaiting_human_verify
trigger: "xAI chat status sometimes switches thinking/listening until speech; mic toggle sometimes says Couldn't connect"
created: 2026-10-28
updated: 2026-10-28
---

## Current Focus
reasoning_checkpoint:
  hypothesis: Captured assistant playback reaches server VAD, causing false speech starts and speaking/listening oscillation; stopping mic mid-utterance prevents VAD from receiving silence needed to commit the turn.
  confirming_evidence:
    - Mic onAudioFrame sends all captured frames during assistant playback.
    - Playback end debounce can set ready between streaming audio chunks.
    - disableMicrophone stops frames and clears userSpeechActive before input_audio_buffer.committed arrives.
    - xAI docs state server_vad commits/responds automatically after silence; manual commit only works when turn_detection is null.
  falsification_test: Reproduced event sequence should not oscillate status during audio gaps; muting during active speech should send paced silence and accept server commit.
  fix_rationale: Suppress mic audio while assistant output plays, hold speaking through streaming gaps, and feed paced silence after mute so server VAD can end the user turn.
  blind_spots: Real xAI/browser timing still requires manual verification.
next_action: Test real xAI conversation at /xai: pause during assistant reply and mute while speaking; report status sequence and whether response arrives.

## Follow-up: thinking/listening loop after 0.1.8
- The share page displays provider `ready` as “listening” whenever the mic is on. Its `wait_for_user` tool handles noise or unaddressed audio.
- xAI provider sent `response.create` after every tool, including `wait_for_user`. A repeated terminal tool call could therefore cycle `thinking` ↔ `ready` without new speech.
- Tool results now support `continueResponse: false`. The app's `wait_for_user` sets it, and xAI provider ends that turn in `ready` regardless of `response.done` ordering.
- Synthetic test confirms no follow-up `response.create`; live xAI event sequence remains unverified.

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
- timestamp: 2026-10-28
  checked: User follow-up and xAI voice API docs
  found: Assistant audio is captured while playing; manual commit is unavailable with server_vad; current mute clears active speech before server commit.
  implication: Feedback can trigger false barge-in, and muting mid-speech strands the turn.
- timestamp: 2026-10-28
  checked: Provider regression tests
  found: Paced silence reaches WebSocket after mute, server commit is still accepted, assistant audio suppresses mic/VAD events, and speaking survives an audio chunk gap.
  implication: Previously failing event paths now preserve turn state in synthetic tests.

## Resolution
root_cause: Provider forwarded microphone capture during its own assistant playback, allowing server VAD to hear output and trigger false speech starts; playback gaps reset status; muting mid-speech stopped input before VAD could commit and discarded the eventual commit.
fix: Suppress mic frames and VAD speech starts while assistant audio streams or plays and for 300ms after; hold speaking through streaming gaps; send paced silent PCM after a mid-speech mute and keep the turn active until server commit.
verification: Eight provider tests pass via package test script; package TypeScript build passes. Real xAI browser run pending.
files_changed: [packages/providers/xai-realtime/src/XAIRealtimeProvider.ts, packages/providers/xai-realtime/src/__tests__/XAIRealtimeProvider.test.js]
