# Summary: Plan 04-01 - Thonburian STT Adapter + Demo Page Scaffold

**Status:** ✅ Complete
**Tasks:** 3/3
**Commits:**
- `1c3ce95`: feat(04-01): scaffold demo page with mock adapters
- `805ff33`: feat(04-01): implement ThonburianSTTAdapter
- `0d628a4`: feat(04-01): wire ThonburianSTTAdapter into demo page

## What Was Built

### Demo Page Scaffold
- Created `/generic-demo` route using `GenericPipelineProvider`
- Initial mock adapters for VAD/STT/LLM/TTS for testing
- Basic UI with connect/disconnect, conversation display, text input
- Status panel showing which adapters are real vs mock

### Thonburian STT Adapter
- Implemented `STTProvider` interface in `src/app/generic-demo/adapters/ThonburianSTTAdapter.ts`
- Posts to `http://localhost:8001/transcribe` with multipart field name `"file"`
- 60s timeout via `AbortSignal.timeout()` + `opts?.signal` composition
- Returns `{text}` without `rejected` field (thonburian-stt has no rejection heuristic)
- Normalizes errors to `Error` instances
- Silently ignores `opts?.language` (service always transcribes as Thai)

### Integration
- Replaced mock STT with real `ThonburianSTTAdapter` in demo page
- Updated status panel to show STT is live
- LLM and TTS remain mocks for 04-02

## Verification

- ✅ Page renders at `/generic-demo` without errors
- ✅ TypeScript compiles cleanly (no new errors)
- ✅ Connect/discover buttons work
- ✅ Service integration ready (requires thonburian-stt running for full testing)

## Key Files Created

- `src/app/generic-demo/page.tsx` - Demo page with GenericPipelineProvider
- `src/app/generic-demo/adapters/ThonburianSTTAdapter.ts` - STT adapter implementation

## Deviations

- None - followed plan exactly

## Notes

- Adapter lives in demo app (`src/app/generic-demo/adapters/`), NOT in SDK packages
- This proves the generic pipeline can use non-OpenAI vendors as local demo code
- Next plan (04-02) will complete the pipeline with JaiTTS + OpenAI LLM

---

**Plan:** 04-01  
**Phase:** 4 - Generic Demo Page  
**Completed:** 2026-06-19
