# Phase 4: Vendor Adapters & Audio Contract - Pattern Map

**Mapped:** 2026-06-19
**Files analyzed:** 6 (2 source classes + 2 test files + 1 round-trip script + 1 doc artifact)
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `packages/providers/generic-stt-tts/src/adapters/ThonburianSTTProvider.ts` | service (adapter) | request-response (multipart upload -> JSON) | `packages/providers/generic-stt-tts/src/adapters/OpenAISTTAdapter.ts` (structure) + `packages/providers/openai-stt-tts/src/STTClient.ts` (fetch/FormData mechanics) | role-match (structure exact, wire-mechanics partial — field name/response shape differ) |
| `packages/providers/generic-stt-tts/src/adapters/JaiTTSProvider.ts` | service (adapter) | request-response (JSON -> binary WAV -> Web Audio playback) | `packages/providers/generic-stt-tts/src/adapters/OpenAITTSAdapter.ts` (structure) + `packages/providers/openai-stt-tts/src/TTSPlayer.ts` (decode/playback mechanics) | role-match (structure exact, decode/playback steps directly reusable) |
| `packages/providers/generic-stt-tts/src/__tests__/ThonburianSTTProvider.test.ts` | test | request-response (mocked fetch) | `packages/providers/openai-stt-tts/src/__tests__/STTClient.test.ts` (fetch-mock mechanics) + `packages/providers/generic-stt-tts/src/__tests__/OpenAISTTAdapter.test.ts` (adapter-level assertions style) | exact (combination of both) |
| `packages/providers/generic-stt-tts/src/__tests__/JaiTTSProvider.test.ts` | test | request-response (mocked fetch + fake AudioContext) | `packages/providers/generic-stt-tts/src/__tests__/OpenAITTSAdapter.test.ts` | role-match (no existing test mocks a real fetch + AudioContext together — net-new combination) |
| `packages/providers/generic-stt-tts/scripts/roundtrip-audio-contract.ts` (or equivalent opt-in path) | test (integration, opt-in) | request-response (real HTTP, no mocks) | No existing analog — new `scripts/` convention | no analog |
| `packages/providers/generic-stt-tts/src/index.ts` (modified — add 2 exports) | config (barrel) | n/a | `packages/providers/generic-stt-tts/src/index.ts` (self, lines 4-14) | exact |

## Pattern Assignments

### `packages/providers/generic-stt-tts/src/adapters/ThonburianSTTProvider.ts` (service, request-response)

**Analogs:** `OpenAISTTAdapter.ts` (class shape/capability flags) + `STTClient.ts` (fetch/FormData mechanics, both genuinely needed since the existing adapter *wraps* a helper class that doesn't exist for this vendor — this new file must inline the fetch logic itself)

**Class shape + capability flags + doc-comment convention** (`OpenAISTTAdapter.ts` lines 1-30):
```typescript
/**
 * OpenAISTTAdapter — wraps @khaveeai/providers-openai-stt-tts's STTClient
 * ...adapts ... to conform to the vendor-neutral STTProvider interface
 * (packages/core/src/types/pipeline.ts).
 */
import { STTProvider, STTResult } from "@khaveeai/core";

export interface OpenAISTTAdapterConfig {
  endpoint: string;
  authToken: string;
}

export class OpenAISTTAdapter implements STTProvider {
  readonly name = "openai-stt";
  readonly supportsStreaming = false;
  readonly supportsRejection = false;

  private readonly endpoint: string;
  private readonly authToken: string;
  private readonly sttClient: STTClient;

  constructor(config: OpenAISTTAdapterConfig, sttClient?: STTClient) {
    this.endpoint = config.endpoint;
    this.authToken = config.authToken;
    this.sttClient = sttClient ?? new STTClient();
  }
```
**For `ThonburianSTTProvider`:** same shape, but `config: { baseUrl?: string; timeoutMs?: number }` per D-01/D-02/D-03 (no `endpoint`/`authToken` fields — explicit divergence, do not copy the auth fields), `name = "thonburian-stt"`, `supportsRejection = false` (BACK-02 deferred per `01-CONTEXT.md` D-06 — vendors that never reject simply omit `STTResult.rejected`).

**FormData/fetch mechanics to copy (with field-name fix)** (`STTClient.ts` lines 35-62):
```typescript
async transcribe(wavBlob: Blob, endpoint: string, authToken: string, language?: string): Promise<string> {
  const form = new FormData();
  form.append("audio", wavBlob, "utterance.wav"); // <-- MUST become "file" for thonburian-stt
  if (language) { form.append("language", language); }

  // Do NOT set Content-Type — the browser sets the multipart boundary.
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken}` }, // <-- DROP for thonburian-stt (D-01: no auth)
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`STT proxy error: ${res.status} ${body}`); // <-- rename message prefix, e.g. "thonburian-stt error:"
  }
  // ... response shape parsing differs, see below
}
```

**Confirmed wire mismatches (do not copy verbatim — these are the exact deltas):**
- Multipart field name: `STTClient.ts:44` uses `"audio"` -> `thonburian-stt/main.py:53` (`async def transcribe(request: Request, file: UploadFile = File(...))`) requires field name **`"file"`**.
- Response shape: `STTClient.ts:64-77` expects `{transcript}` or `{data:{transcript}}` -> `thonburian-stt/main.py:63` returns **`{"text": result["text"]}`** — a flat `{text: string}`, mapping directly onto `STTResult.text` with no reshaping needed.
- Auth: `STTClient.ts:51-57` sends `Authorization: Bearer` -> drop entirely per D-01 (no `authToken` field at all in the new adapter's config).
- No request timeout exists in `STTClient.ts` -> D-03 requires `AbortSignal.timeout(this.timeoutMs)` (default 60000) added to the `fetch()` call's `signal` option. `STTProvider.transcribe()`'s interface signature has no external `opts.signal` field (confirmed in `pipeline.ts` lines 139-152), so per RESEARCH's Open Question recommendation, use `AbortSignal.timeout(this.timeoutMs)` alone — no `AbortSignal.any()` composition needed on the STT side (that's TTS-only, see below).

**Error normalization (apply CLAUDE.md pattern, not present in `STTClient.ts` itself):**
```typescript
// CLAUDE.md Error Handling: normalize unknown catch values to Error
try {
  const res = await fetch(...);
  if (!res.ok) { /* throw new Error(...) */ }
  const json = (await res.json()) as { text: string };
  return { text: json.text };
} catch (error) {
  throw error instanceof Error ? error : new Error(String(error));
}
```

**D-04 silent-ignore convention** (no existing analog explicitly silently ignores a param — this is new but matches the `signal`-is-best-effort philosophy already in `pipeline.ts` lines 169-170, 199): accept `opts?.language` in the method signature (interface compliance) but never read it / never append it to the form. Add a one-line comment citing D-04, e.g. `// D-04: opts.language is silently ignored — thonburian-stt always transcribes as Thai.`

---

### `packages/providers/generic-stt-tts/src/adapters/JaiTTSProvider.ts` (service, request-response)

**Analogs:** `OpenAITTSAdapter.ts` (class shape) + `TTSPlayer.ts` (decode/playback mechanics — directly reusable since `decodeAudioData` works on any WAV regardless of source)

**Class shape + speak() signature to copy** (`OpenAITTSAdapter.ts` lines 39-70):
```typescript
export class OpenAITTSAdapter implements TTSProvider {
  readonly name = "openai-tts";
  readonly supportsStreaming = false;

  async speak(
    text: string,
    opts: {
      audioContext: AudioContext;
      onAudioData?: (analyser: AnalyserNode, audioContext: AudioContext) => void;
      voice?: string;
      speed?: number;
      signal?: AbortSignal;
    }
  ): Promise<void> {
    if (opts.signal?.aborted) {
      return;
    }
    // ... bridges external signal, delegates to TTSPlayer
  }
}
```
For `JaiTTSProvider`: same `speak()` signature (interface-mandated), `name = "jai-tts"`, `supportsStreaming = false`. Unlike `OpenAITTSAdapter`, there is no existing `TTSPlayer`-equivalent to delegate to (wire shapes incompatible per CONTEXT.md Integration Points) — `JaiTTSProvider` must inline its own fetch + the decode/playback steps below, copied near-verbatim from `TTSPlayer.speak()` since the Web Audio side is 100% vendor-agnostic.

**Decode + dual-path playback steps to copy verbatim** (`TTSPlayer.ts` lines 94-134):
```typescript
// Step 3: read the binary audio response
const arrayBuffer = await res.arrayBuffer();

// Step 4: decode — use arrayBuffer.slice(0) because decodeAudioData() transfers
// (detaches) the passed ArrayBuffer, making any further access throw a TypeError
const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

// Step 5: create buffer source
const source = audioContext.createBufferSource();
source.buffer = audioBuffer;

// Step 6: create analyser with the same parameters as OpenAIRealtimeProvider
const analyser = audioContext.createAnalyser();
analyser.fftSize = 2048;
analyser.smoothingTimeConstant = 0.6;

// Step 7: dual-path connections
source.connect(analyser);
source.connect(audioContext.destination);

// Step 8: resume the AudioContext, fire onAudioData AFTER resume() resolves
await audioContext.resume();
if (audioContext.state === "running") {
  onAudioData(analyser, audioContext);
}

// Step 9: start playback and resolve when the source finishes
source.start();
return new Promise<void>((resolve) => {
  source.onended = () => resolve();
});
```
Copy these 7 steps verbatim into `JaiTTSProvider.speak()` — this is browser-native Web Audio logic with zero vendor-specific assumptions (confirmed in `04-CONTEXT.md` Code Context: "the Web Audio API auto-resamples on decode... no manual resampling needed").

**Fetch call to write new (cannot reuse `TTSPlayer`'s fetch — incompatible request shape):**
- `TTSPlayer.ts:67-81` POSTs JSON `{text, voice, speed, model, ttsInstructions}` with `Authorization: Bearer` header to a single positional-args API.
- `jai-tts/main.py:92-97` (`class SynthesizeRequest(BaseModel): text: str` / `async def synthesize(request: Request, body: SynthesizeRequest)`) only accepts `{"text": string}`, no auth header, returns raw `audio/wav` bytes directly (`main.py:121`, `Response(content=wav_bytes, media_type="audio/wav")`).
- New fetch call must be: `fetch(`${baseUrl}/synthesize`, { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ text }), signal: combinedSignal })` — no `Authorization` header (D-01).

**Timeout + external signal composition (TTS side DOES have `opts.signal` per `pipeline.ts` line 209)** — this is the one place `AbortSignal.any()` is required:
```typescript
const signals: AbortSignal[] = [AbortSignal.timeout(this.timeoutMs)];
if (opts.signal) signals.push(opts.signal);
const combinedSignal = AbortSignal.any(signals);
```
This differs from `OpenAITTSAdapter`'s approach (`OpenAITTSAdapter.ts:79-85`, which bridges abort via `addEventListener` to a separate `player.cancel()` call) because `JaiTTSProvider` owns its own single `fetch()` directly — there is no separate player object with its own `AbortController` to bridge to. Use `AbortSignal.any()` directly on the `fetch()` call's `signal` option instead.

**AbortError swallow pattern** (`TTSPlayer.ts` lines 82-88) — decide per RESEARCH Pitfall 5 whether to special-case `AbortError`/`TimeoutError` at all; RESEARCH recommends NOT special-casing (let both normalize through the generic `error instanceof Error ? error : new Error(String(error))` path) since D-03 frames timeout as "any other adapter failure," unlike `TTSPlayer.cancel()`'s deliberate-cancel case which IS special-cased because cancellation there is a normal, expected user-driven interrupt.

**D-04 silent-ignore convention:** accept `opts.voice`/`opts.speed` in the method signature (interface compliance) but never read them / never forward them in the JSON body — add a comment citing D-04 (`jai-tts hardcodes its default voice and speed=1.0`).

---

### `packages/providers/generic-stt-tts/src/__tests__/ThonburianSTTProvider.test.ts` (test)

**Analogs:** `STTClient.test.ts` (fetch-mocking mechanics) + `OpenAISTTAdapter.test.ts` (assertion style/describe-block naming convention)

**Fetch-mocking setup to copy** (`STTClient.test.ts` lines 1-18):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("ADPT-01: ThonburianSTTProvider posts multipart and returns STTResult", () => {
  const wavBlob = new Blob(["x"], { type: "audio/wav" });

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
  // ...
});
```

**Assertion pattern to copy** (`STTClient.test.ts` lines 20-55, adapted for field name `"file"` and response `{text}` instead of `{transcript}`):
```typescript
it("posts to baseUrl/transcribe with FormData field 'file' and 'utterance.wav' filename, returns STTResult on 200", async () => {
  const mockFetch = vi.mocked(fetch);
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ text: "สวัสดี" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

  const provider = new ThonburianSTTProvider({ baseUrl: "http://localhost:8001" });
  const result = await provider.transcribe(wavBlob);

  expect(result).toEqual({ text: "สวัสดี" });
  expect(result.rejected).toBeUndefined();

  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe("http://localhost:8001/transcribe");
  expect((calledInit.headers as Record<string, string> | undefined)?.["Authorization"]).toBeUndefined(); // D-01: no auth header

  const body = calledInit.body as FormData;
  expect(body.get("file")).toBeInstanceOf(File); // NOT "audio" — field name confirmed against thonburian-stt/main.py
});

it("throws an Error with the status code when the service responds non-2xx", async () => {
  const mockFetch = vi.mocked(fetch);
  mockFetch.mockResolvedValueOnce(new Response("Bad Request", { status: 400 }));
  await expect(provider.transcribe(wavBlob)).rejects.toThrow("400");
});
```

**Adapter-level assertions to also include** (style from `OpenAISTTAdapter.test.ts` lines 26-45):
```typescript
it("exposes supportsStreaming === false and supportsRejection === false", () => {
  expect(provider.supportsStreaming).toBe(false);
  expect(provider.supportsRejection).toBe(false);
});

it("declares a Provider.name", () => {
  expect(provider.name).toBe("thonburian-stt");
});

it("silently ignores opts.language without forwarding it (D-04)", async () => {
  // assert no "language" field appended to FormData
});
```

---

### `packages/providers/generic-stt-tts/src/__tests__/JaiTTSProvider.test.ts` (test)

**Analogs:** `OpenAITTSAdapter.test.ts` (closest adapter-level test, though it mocks `TTSPlayer` rather than `fetch`+`AudioContext` directly — this new test combines `STTClient.test.ts`'s raw-fetch-mocking approach with a fake `AudioContext`, a genuinely new combination not yet precedented in this repo)

Read `OpenAITTSAdapter.test.ts` for the assertion-naming convention (`describe("ADPT-XX: ...")`) and the `opts.signal?.aborted` pre-check test case pattern — both directly transferable. The fetch-mock + binary response setup must follow `STTClient.test.ts`'s `vi.stubGlobal("fetch", ...)` pattern but return a `Response` with an `ArrayBuffer`/binary body and `audio/wav` content type instead of JSON. A minimal fake `AudioContext` (stub `decodeAudioData`, `createBufferSource`, `createAnalyser`, `resume`, `state`) is required since no Node-global `AudioContext` exists — this is new test infrastructure, not copyable from any existing test file.

---

### `packages/providers/generic-stt-tts/scripts/roundtrip-audio-contract.ts` (test, integration, opt-in)

**No analog found** — confirmed by RESEARCH: "there is no existing `scripts/` directory convention anywhere in `packages/providers/*`". RESEARCH's own Code Examples section (lines 463-501 of `04-RESEARCH.md`) already contains a full skeleton; treat that as the template rather than any existing codebase file. Key constraint to satisfy from `vitest.config.ts` (confirmed, lines 1-12): `include: ["src/**/*.test.ts"]` only matches files under `src/`. Placing this script under a sibling `scripts/` directory at the package root (not under `src/`) automatically satisfies D-06's "not in default `pnpm test`" requirement with zero config changes — confirmed safe, no need to touch `vitest.config.ts`'s `include` glob at all.

---

### `packages/providers/generic-stt-tts/src/index.ts` (barrel, modified)

**Analog:** itself — existing export pattern (lines 1-14):
```typescript
export { OpenAISTTAdapter } from "./adapters/OpenAISTTAdapter";
export type { OpenAISTTAdapterConfig } from "./adapters/OpenAISTTAdapter";

export { OpenAITTSAdapter } from "./adapters/OpenAITTSAdapter";
export type { OpenAITTSAdapterConfig } from "./adapters/OpenAITTSAdapter";
```
Append two equivalent pairs:
```typescript
export { ThonburianSTTProvider } from "./adapters/ThonburianSTTProvider";
export type { ThonburianSTTProviderConfig } from "./adapters/ThonburianSTTProvider";

export { JaiTTSProvider } from "./adapters/JaiTTSProvider";
export type { JaiTTSProviderConfig } from "./adapters/JaiTTSProvider";
```

## Shared Patterns

### Error normalization
**Source:** CLAUDE.md "Error Handling" section; pattern already used throughout `openai-stt-tts`/`openai-realtime` provider classes (e.g. `OpenAISTTTTSProvider.ts:281-285`)
**Apply to:** Both `ThonburianSTTProvider.transcribe()` and `JaiTTSProvider.speak()` — wrap the `fetch()` call (and any synchronous code that could throw) in `try { ... } catch (error) { throw error instanceof Error ? error : new Error(String(error)); }`. This is the same normalization the timeout-triggered abort (D-03) must flow through per CONTEXT.md D-03.
```typescript
} catch (error) {
  throw error instanceof Error ? error : new Error(String(error));
}
```

### Multipart FormData upload without manual Content-Type
**Source:** `packages/providers/openai-stt-tts/src/STTClient.ts:50-57` (comment: "Do NOT set Content-Type — the browser sets the multipart boundary")
**Apply to:** `ThonburianSTTProvider.transcribe()`'s fetch call only — field name must be `"file"` (not `"audio"`), confirmed against `thonburian-stt/main.py:53`.
```typescript
const form = new FormData();
form.append("file", audio, "utterance.wav");
const res = await fetch(`${this.baseUrl}/transcribe`, { method: "POST", body: form, signal });
// No headers object — Content-Type is auto-set for FormData bodies.
```

### Non-2xx error message convention
**Source:** `STTClient.ts:59-62` / `TTSPlayer.ts:90-92` (`throw new Error(\`<service> error: ${res.status} ${body}\`)`)
**Apply to:** Both new adapters — `thonburian-stt error: ${res.status} ${body}` and `jai-tts error: ${res.status} ${body}` respectively. Tests assert via `.rejects.toThrow("<status>")` per existing convention in `STTClient.test.ts:66-69`.

### Timeout via native `AbortSignal`
**Source:** New pattern (not in existing codebase) — confirmed available/typed by RESEARCH directly via toolchain probe (Node v23.5.0, TS 5.9.2 `lib.dom.d.ts`)
**Apply to:** Both adapters, per D-03 (default 60000ms). STT side: `AbortSignal.timeout(this.timeoutMs)` alone (no external signal exists on `STTProvider.transcribe()`). TTS side: `AbortSignal.any([AbortSignal.timeout(this.timeoutMs), opts.signal].filter(Boolean))` since `TTSProvider.speak()`'s `opts.signal` already exists (`pipeline.ts:209`).

### Decode + dual-path lip-sync playback
**Source:** `packages/providers/openai-stt-tts/src/TTSPlayer.ts:94-134` (steps 3-9, fftSize=2048/smoothingTimeConstant=0.6 also mirrored in `OpenAIRealtimeProvider.ts`'s `setupAudioOutputAnalysis`)
**Apply to:** `JaiTTSProvider.speak()` only — copy verbatim, vendor-agnostic Web Audio logic, no jai-tts-specific changes needed beyond the upstream fetch.

### Silent-ignore of unsupported per-call options (D-04)
**Source:** Precedent established for `signal` in Phase 2 (D-01/D-02 of `02-CONTEXT.md`); extended here to `language`/`voice`/`speed`
**Apply to:** `ThonburianSTTProvider.transcribe(audio, opts?: {language?})` — never read `opts.language`. `JaiTTSProvider.speak(text, opts)` — never read `opts.voice`/`opts.speed`. No `console.warn`, no error — accept the param for interface compliance, document via inline comment citing D-04.

### Mocked-fetch test setup
**Source:** `packages/providers/openai-stt-tts/src/__tests__/STTClient.test.ts:12-18`
**Apply to:** Both new test files.
```typescript
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.restoreAllMocks();
});
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/providers/generic-stt-tts/scripts/roundtrip-audio-contract.ts` | test (integration) | request-response (real services, no mocks) | No `scripts/` directory or opt-in-integration-test convention exists anywhere in this monorepo (confirmed by RESEARCH and by directory listing of `packages/providers/generic-stt-tts`). Use RESEARCH's own Code Examples skeleton (`04-RESEARCH.md` lines 465-501) as the template; key structural constraint already confirmed: placing the file outside `src/` automatically excludes it from `vitest.config.ts`'s `include: ["src/**/*.test.ts"]` glob with zero config changes. |
| Audio wire-format documentation artifact (ADPT-03) | config/docs | n/a | No existing per-package README section or doc-comment convention specifically documents wire audio formats anywhere in the repo today; `CLAUDE.md`'s own "Comments" conventions (file-header block comments, JSDoc field docs) are the closest applicable pattern — recommend a file-header block comment on both new adapter files (matching `STTClient.ts:1-16`'s style) plus a consolidated section in `packages/providers/generic-stt-tts/README.md`, per Claude's Discretion in `04-CONTEXT.md`. |

## Metadata

**Analog search scope:** `packages/providers/generic-stt-tts/src/adapters/`, `packages/providers/generic-stt-tts/src/__tests__/`, `packages/providers/openai-stt-tts/src/` (incl. `__tests__/`), `packages/core/src/types/pipeline.ts`, `/Users/whitemalt/Documents/thonburian-stt/main.py`, `/Users/whitemalt/Documents/jai-tts/main.py`
**Files scanned:** 11 (4 adapter files, 1 interface file, 2 helper classes, 3 existing test files, 1 vitest config) + 2 external service source files
**Pattern extraction date:** 2026-06-19
