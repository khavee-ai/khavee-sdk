# Summary: Plan 04-02 - JaiTTS Adapter + Demo Integration

**Status:** ✅ Complete
**Tasks:** 2/2
**Commits:**
- `0ff34cc`: feat(04-02): implement JaiTTSAdapter
- `db24455`: feat(04-02): wire JaiTTSAdapter and OpenAILLMAdapter into demo page

## What Was Built

### JaiTTS Adapter
- Implemented `TTSProvider` interface in `src/app/generic-demo/adapters/JaiTTSAdapter.ts`
- Posts to `http://localhost:8002/synthesize` with JSON `{text}`
- Receives raw `audio/wav` bytes (24kHz/mono/16-bit per AUDIO_FORMAT.md)
- Decodes via caller-supplied `AudioContext.decodeAudioData()` (auto-resamples)
- Creates `AudioBufferSourceNode` with dual-path routing (analyser + destination)
- Returns promise resolving when playback ends (`source.onended`)
- 60s timeout via `AbortSignal.timeout()` + `opts?.signal` composition
- Silently ignores `opts?.voice` and `opts?.speed` (server-hardcoded)

### Demo Page Integration
- Replaced mock LLM with `OpenAILLMAdapter({ apiKey, model: 'gpt-4o' })`
- Replaced mock TTS with `JaiTTSAdapter()`
- VAD remains mock (needs MicVAD integration for real mic input)
- Updated status panel to show all three real adapters

## Verification

- ✅ TypeScript compiles cleanly
- ✅ Full speech pipeline functional: speech → Thonburian STT → OpenAI LLM → JaiTTS TTS → audio playback
- ✅ Audio playback is actually audible (not just completing silently)
- ✅ All four stages wired (VAD still mock, but STT/LLM/TTS are real)

## Key Files Created/Modified

- `src/app/generic-demo/adapters/JaiTTSAdapter.ts` - TTS adapter implementation
- `src/app/generic-demo/page.tsx` - Updated to use real LLM and TTS

## Self-Check: PASSED

- ✅ No TypeScript errors
- ✅ Adapter follows TTSProvider contract exactly
- ✅ Dual-path playback matches TTSPlayer pattern
- ✅ Error normalization applied
- ✅ Timeout handling implemented
- ✅ Voice/speed opts silently ignored per spec

## Deviations

- None - followed plan exactly

## Notes

- Wave 1 complete: Full end-to-end pipeline with three real adapters
- VAD is the only remaining mock (MicVAD integration is polish/future work)
- Demo proves generic pipeline works with mixed vendors (Thai STT + OpenAI LLM + Thai TTS)
- Ready for 04-03 (audio format docs + round-trip test + polish)

---

**Plan:** 04-02  
**Phase:** 4 - Generic Demo Page  
**Completed:** 2026-06-19
