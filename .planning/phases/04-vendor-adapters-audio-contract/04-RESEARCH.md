# Phase 4: Vendor Adapters & Audio Contract - Research

**Researched:** 2026-06-19
**Domain:** Browser-fetch HTTP adapters (multipart upload + binary response decode) bridging two vendor-neutral TypeScript interfaces to two local Python FastAPI services
**Confidence:** HIGH

## Summary

This phase is narrow and well-bounded: two new classes (`ThonburianSTTProvider`, `JaiTTSProvider`) in `packages/providers/generic-stt-tts/src/adapters/` that each make one `fetch()` call to a real local service and reshape the result into the `STTProvider`/`TTSProvider` contracts already defined in `packages/core/src/types/pipeline.ts`. Nearly every architectural question was already resolved in `04-CONTEXT.md` (D-01 through D-06) by inspecting the real backend source. What remains is confirming the literal TypeScript contracts to implement against, the exact `fetch`/`FormData`/`AbortSignal` composition mechanics, and the test-runner mechanics for an opt-in round-trip script.

The most consequential finding: **`AbortSignal.any()` is natively available and fully typed** in this repo's toolchain (Node v23.5.0, TypeScript 5.9.2's `lib.dom.d.ts`) — no polyfill or manual signal-merging utility is needed to combine D-03's internal 60s timeout with a caller-supplied `opts.signal`. The packages' `tsconfig.packages.json` has no explicit `lib` array, so TypeScript falls back to its default-lib-for-target behavior which always includes `DOM`/`DOM.Iterable` regardless of `target` — confirmed by the fact `openai-stt-tts` already compiles clean today using `Blob`/`fetch`/`AudioContext` with zero `lib` configuration. The same defaults apply to `generic-stt-tts` (identical tsconfig).

Second finding: `TTSProvider.speak()` returns `Promise<void>` and takes a caller-supplied `AudioContext` to decode/play through directly — `JaiTTSProvider` does NOT return audio data to its caller. It must replicate `TTSPlayer`'s `decodeAudioData()` + dual-path-analyser + `source.start()` playback pattern internally, just with a simpler unauthenticated JSON-only fetch.

Third finding: there is no existing `scripts/` directory convention anywhere in `packages/providers/*` — the opt-in round-trip script (D-06) is genuinely new territory for this monorepo, and the planner should pick vitest's own file-pattern exclusion (cleanest, zero new dependency) over introducing `tsx`/`ts-node` as a new devDependency, unless a stronger reason emerges during planning.

**Primary recommendation:** Build `ThonburianSTTProvider` and `JaiTTSProvider` as flat, self-contained classes (no shared HTTP helper extraction — only two call sites, premature abstraction). Use `AbortSignal.any([AbortSignal.timeout(timeoutMs), opts?.signal].filter(Boolean))` to compose D-03's timeout with the interface's best-effort external signal. Write the round-trip script as a `.ts` file under a new `scripts/` directory, executed via `vitest run` against an explicit file pattern NOT matched by the default `include`, requiring no new runtime dependency.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| WAV utterance encoding (VAD → adapter input) | Browser / Client | — | Already produced upstream by `@ricky0123/vad-web`'s `MicVAD`/`encodeWAV` (Phase 1/2 territory, untouched here); `ThonburianSTTProvider` only consumes the resulting `Blob` |
| Multipart upload to `thonburian-stt` | API / Backend (adapter as HTTP client) | Browser / Client (fetch + FormData are browser/Node-global APIs) | The adapter is a thin HTTP client living in SDK code, but it runs wherever the SDK runs (browser primarily, Node for the opt-in test script) — it owns request construction, not the audio capture itself |
| Thai ASR inference | API / Backend (external service) | — | Owned entirely by `thonburian-stt`'s FastAPI process (port 8001); the adapter never touches model internals |
| JSON request → WAV bytes response for TTS | API / Backend (adapter as HTTP client) | — | Same shape as STT direction, reversed payload |
| Thai TTS voice-cloning inference | API / Backend (external service) | — | Owned entirely by `jai-tts`'s FastAPI process (port 8002) |
| WAV decode + Web Audio playback | Browser / Client | — | `AudioContext.decodeAudioData()` and `AudioBufferSourceNode` are browser-only APIs (CLAUDE.md "Browser-only APIs" constraint) — `JaiTTSProvider.speak()` runs this client-side exactly like `TTSPlayer` does today |
| Audio wire-format documentation | Code / Docs (no runtime tier) | — | A doc artifact (comment block or README section), not a running component |
| Round-trip test orchestration | Dev tooling (Node script) | — | Runs under Node (via vitest's Node test environment), hits real services over `localhost` HTTP — not part of any production runtime tier |

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADPT-01 | `ThonburianSTTProvider` implements `STTProvider` by calling `thonburian-stt` over HTTP, posting whole VAD-segmented utterances | Confirmed wire shape (`multipart/form-data`, field name `file`, response `{"text": string}`) from `thonburian-stt/main.py`; confirmed `STTProvider.transcribe(audio: Blob, opts?: {language?: string}): Promise<STTResult>` contract from `pipeline.ts`; confirmed `FormData`/`fetch` Content-Type pitfall pattern from `STTClient.ts` |
| ADPT-02 | `JaiTTSProvider` implements `TTSProvider` by calling `jai-tts` over HTTP and returning playable WAV audio | Confirmed wire shape (`POST /synthesize` JSON `{"text": string}` → raw `audio/wav` bytes, 24kHz/mono/16-bit) from `jai-tts/main.py`; confirmed `TTSProvider.speak()` returns `Promise<void>` and decodes via caller-supplied `AudioContext`, matching `TTSPlayer.speak()`'s exact decode/play pattern |
| ADPT-03 | Audio wire format (sample rate, encoding, channels) is documented in one place and covered by a round-trip test | Confirmed exact format facts to document (16kHz/mono/float32 STT input vs. 24kHz/mono/int16 TTS output) already verified in `04-CONTEXT.md` Specific Ideas; this research adds the test-runner mechanics (`vitest run` opt-in pattern, no new dependency required) and the Node-global-API availability check (`fetch`/`FormData`/`Blob`/`AbortSignal.any` all native on Node v23.5.0, no polyfill) |

## Standard Stack

### Core

No new runtime dependencies are required for the adapters themselves. All needed APIs (`fetch`, `FormData`, `Blob`, `AbortController`, `AbortSignal.timeout()`, `AbortSignal.any()`) are native browser globals AND native Node v23.5.0 globals — confirmed by direct probe in this research session.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|---------------|
| `@khaveeai/core` | workspace:* (existing dep) | Supplies `STTProvider`/`TTSProvider`/`STTResult` contracts | Already a dependency of `generic-stt-tts`; no version change needed |

### Supporting (round-trip test script only, D-06)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | ^2.0.0 (already a devDependency, installed 2.1.9) | Runs the opt-in round-trip script as a normal test file excluded from the default `include` glob, OR invoked directly via `vitest run <explicit-path>` | Preferred — zero new dependency, reuses existing test runner mental model |
| `tsx` | 4.22.4 `[VERIFIED: npm registry]` `[slopcheck: OK]` | Alternative: run the script as a plain `.ts` file via `node --import tsx` or `tsx script.ts` if the planner wants the script to NOT look like a test file at all | Only if the planner decides vitest's test-shaped API (`describe`/`it`) is the wrong fit for what's conceptually a manual diagnostic script, not an assertion suite |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled `fetch`+`FormData` multipart upload | A multipart library (e.g. `form-data` npm package) | Unnecessary — native `FormData` + `fetch` is already the exact pattern `STTClient.ts` uses successfully; adding a library here would be the "Don't Hand-Roll" anti-pattern in reverse (rolling in a dependency for something the platform already does natively) |
| `AbortSignal.any()` for combining timeout + external signal | A manual "race two AbortControllers" helper function | `AbortSignal.any()` is native, typed, and zero-code — manually composing two controllers is exactly the kind of thing `Don't Hand-Roll` warns about reinventing |
| Extracting a shared `HttpAdapterBase` class for both adapters | Two fully independent classes | CONTEXT.md leaves this as Claude's Discretion; with only 2 call sites and genuinely different payload shapes (multipart vs JSON, blob response vs JSON response), a shared base class adds an abstraction layer for marginal duplication reduction — recommend NOT extracting, see Architecture Patterns below |

**Installation:** No new packages required for the adapters themselves. If the planner chooses the `tsx` route for D-06's script (rather than vitest), add as a devDependency:
```bash
pnpm add -D tsx --filter @khaveeai/providers-generic-stt-tts
```

**Version verification:** `tsx@4.22.4` confirmed as latest via `npm view tsx version` and `npm view tsx dist-tags` (both returned `4.22.4`) on 2026-06-19. `vitest@2.1.9` confirmed already installed and resolvable via `npx vitest --version` inside `packages/providers/generic-stt-tts`.

## Package Legitimacy Audit

> Only one net-new package was evaluated (`tsx`) since it is the only candidate dependency this phase might introduce, and only conditionally (D-06's script can be built with zero new dependencies via vitest). slopcheck was available and ran successfully.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|--------------|
| `tsx` | npm | Mature (multi-year, actively maintained `esbuild`-based TS runner) | High (widely used in Node tooling ecosystem) | github.com/privatenumber/tsx | `[OK]` | Approved, but only needed IF the planner rejects the zero-dependency vitest-script approach |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

slopcheck ran successfully (already installed in this environment); no packages were marked `[ASSUMED]` due to tool unavailability. The package name `tsx` was discovered via training-data knowledge of the Node TS-runner ecosystem (not via Context7/official docs), so per the provenance rule it is tagged `[VERIFIED: npm registry]` only for the registry-existence-and-version fact, not as an unconditionally-endorsed recommendation — see Assumptions Log.

## Architecture Patterns

### System Architecture Diagram

```
                 VAD-segmented WAV Blob
                 (16kHz, mono, float32 PCM)
                         |
                         v
   +---------------------------------------------+
   |     ThonburianSTTProvider.transcribe()       |
   |  1. new FormData(); form.append("file", blob)|
   |  2. fetch(baseUrl + "/transcribe", {          |
   |       method: "POST", body: form,             |
   |       signal: combinedSignal })  -- NO         |
   |       Content-Type header set manually        |
   +---------------------------------------------+
                         |
                         v  HTTP POST multipart/form-data
            +-------------------------------+
            |   thonburian-stt (port 8001)   |
            |   Whisper-th-large-v3-combined |
            |   always transcribes as Thai   |
            +-------------------------------+
                         |
                         v  200 OK  {"text": "..."}
   +---------------------------------------------+
   |  ThonburianSTTProvider maps response to       |
   |  STTResult: { text }  (rejected omitted)      |
   +---------------------------------------------+
                         |
                         v
              STTResult returned to caller
                 (orchestrator, Phase 5)


                      text: string
                         |
                         v
   +---------------------------------------------+
   |       JaiTTSProvider.speak(text, opts)        |
   |  1. fetch(baseUrl + "/synthesize", {           |
   |       method: "POST",                          |
   |       headers: {"Content-Type":"application/json"},|
   |       body: JSON.stringify({ text }),          |
   |       signal: combinedSignal })                |
   +---------------------------------------------+
                         |
                         v  HTTP POST application/json
              +-------------------------------+
              |    jai-tts (port 8002)         |
              |  JaiTTS-F5TTS voice cloning     |
              |  hardcoded default voice/speed  |
              +-------------------------------+
                         |
                         v  200 OK  audio/wav bytes
                            (24kHz, mono, int16 PCM)
   +---------------------------------------------+
   |  JaiTTSProvider:                              |
   |  1. res.arrayBuffer()                         |
   |  2. opts.audioContext.decodeAudioData(buf.slice(0)) |
   |  3. create AudioBufferSourceNode               |
   |  4. dual-path connect: source->analyser,       |
   |     source->destination                       |
   |  5. opts.onAudioData?.(analyser, audioContext) |
   |  6. source.start(); resolve on source.onended  |
   +---------------------------------------------+
                         |
                         v
                  Promise<void> resolves
              (audio already playing/played)
```

### Recommended Project Structure

```
packages/providers/generic-stt-tts/
├── src/
│   ├── adapters/
│   │   ├── OpenAISTTAdapter.ts        # existing, untouched
│   │   ├── OpenAITTSAdapter.ts        # existing, untouched
│   │   ├── OpenAIVADAdapter.ts        # existing, untouched
│   │   ├── OpenAILLMAdapter.ts        # existing, untouched
│   │   ├── ThonburianSTTProvider.ts   # NEW — ADPT-01
│   │   └── JaiTTSProvider.ts          # NEW — ADPT-02
│   ├── __tests__/
│   │   ├── ThonburianSTTProvider.test.ts   # NEW — mocked-fetch unit tests, runs in default `pnpm test`
│   │   └── JaiTTSProvider.test.ts          # NEW — mocked-fetch unit tests, runs in default `pnpm test`
│   └── index.ts                       # add 2 new exports
├── scripts/                            # NEW directory — no precedent elsewhere in repo
│   └── roundtrip-audio-contract.ts    # NEW — D-05/D-06 opt-in real-service test
└── README.md                          # NEW or amended — ADPT-03 wire-format doc (if doc-comment route not chosen)
```

### Pattern 1: Composing an internal timeout with an external best-effort signal

**What:** D-03 requires a 60s internal timeout on both adapters; the `STTProvider`/`TTSProvider` interfaces also accept (TTS) or could accept (STT currently has no `signal` param — see Open Questions) an external `AbortSignal` from the caller. These must compose without one cancelling the other incorrectly — i.e., whichever fires first should abort the fetch, and the resulting error should still normalize correctly.

**When to use:** Both adapters' single `fetch()` call.

**Example:**
```typescript
// Source: MDN AbortSignal.any() — https://developer.mozilla.org/docs/Web/API/AbortSignal/any_static
// Verified available + typed in this repo's toolchain: Node v23.5.0 (native),
// TypeScript 5.9.2's lib.dom.d.ts declares `AbortSignal.any(signals: AbortSignal[]): AbortSignal`.
const signals: AbortSignal[] = [AbortSignal.timeout(this.timeoutMs)];
if (opts?.signal) signals.push(opts.signal);
const combinedSignal = AbortSignal.any(signals);

try {
  const res = await fetch(url, { method: "POST", body: form, signal: combinedSignal });
  // ...
} catch (error) {
  throw error instanceof Error ? error : new Error(String(error));
}
```
`AbortSignal.timeout(ms)` fires its own abort reason (a `TimeoutError` DOMException) distinct from a caller's manual `controller.abort()` — both surface through `combinedSignal`'s `abort` event/`aborted` flag identically, and `fetch()` rejects with an `AbortError`/`TimeoutError` either way, which the existing `error instanceof Error ? error : new Error(String(error))` normalization (CLAUDE.md) already handles correctly without needing to distinguish which signal fired.

### Pattern 2: Multipart FormData upload without manual Content-Type

**What:** `thonburian-stt`'s `/transcribe` endpoint expects a standard multipart body with field name `file`. Browsers (and Node's native `fetch`) automatically compute and set the `Content-Type: multipart/form-data; boundary=...` header when `body` is a `FormData` instance — manually setting `Content-Type` to a string breaks the boundary and the server cannot parse the body.

**When to use:** `ThonburianSTTProvider.transcribe()`'s fetch call.

**Example:**
```typescript
// Source: pattern already proven in packages/providers/openai-stt-tts/src/STTClient.ts:50
// "Do NOT set Content-Type — the browser sets the multipart boundary."
const form = new FormData();
form.append("file", audio, "utterance.wav"); // field name MUST be "file" per thonburian-stt/main.py's `file: UploadFile = File(...)`

const res = await fetch(`${this.baseUrl}/transcribe`, {
  method: "POST",
  body: form,
  signal: combinedSignal,
  // No headers object — Content-Type is set automatically for FormData bodies.
});
```
Filename (`"utterance.wav"`) is not strictly required by `thonburian-stt`'s implementation (it reads `await file.read()` and writes to a `tempfile.NamedTemporaryFile(suffix=".wav")` regardless of the uploaded filename), but supplying it costs nothing and matches the existing `STTClient.ts` convention for cross-browser consistency.

### Pattern 3: Decoding a raw `audio/wav` Response into Web Audio playback

**What:** `jai-tts`'s `/synthesize` returns the WAV file as a raw binary body (`Response(content=wav_bytes, media_type="audio/wav")` in FastAPI) — there is no JSON envelope, no base64 wrapping. The adapter reads it as an `ArrayBuffer` and decodes it exactly the way `TTSPlayer.speak()` already does.

**When to use:** `JaiTTSProvider.speak()`.

**Example:**
```typescript
// Source: pattern proven in packages/providers/openai-stt-tts/src/TTSPlayer.ts:94-134
const res = await fetch(`${this.baseUrl}/synthesize`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text }), // jai-tts only accepts {text} -- D-04 ignores opts.voice/opts.speed
  signal: combinedSignal,
});

if (!res.ok) {
  const body = await res.text();
  throw new Error(`jai-tts error: ${res.status} ${body}`);
}

const arrayBuffer = await res.arrayBuffer();
// .slice(0) required: decodeAudioData() detaches/transfers the ArrayBuffer
const audioBuffer = await opts.audioContext.decodeAudioData(arrayBuffer.slice(0));

const source = opts.audioContext.createBufferSource();
source.buffer = audioBuffer;

const analyser = opts.audioContext.createAnalyser();
analyser.fftSize = 2048;
analyser.smoothingTimeConstant = 0.6;

source.connect(analyser);
source.connect(opts.audioContext.destination);

await opts.audioContext.resume();
if (opts.audioContext.state === "running") {
  opts.onAudioData?.(analyser, opts.audioContext);
}

source.start();
return new Promise<void>((resolve) => {
  source.onended = () => resolve();
});
```
`AudioContext.decodeAudioData()` auto-resamples — `jai-tts`'s fixed 24kHz output plays correctly regardless of the `AudioContext`'s own native sample rate (typically 48kHz in most browsers). No manual resampling is needed (confirmed already in `04-CONTEXT.md` Code Context).

### Anti-Patterns to Avoid

- **Reusing `STTClient`/`TTSPlayer` by subclassing or wrapping with field-renaming shims:** The wire shapes are genuinely incompatible (different field names, different response envelopes, different auth requirements) — forcing reuse here produces a leakier abstraction than writing two small, direct, independent classes. CONTEXT.md's Integration Points section already reached this conclusion; this research confirms it architecturally.
- **Setting `Content-Type: multipart/form-data` manually on the `FormData` fetch call:** Breaks the multipart boundary parameter the browser/Node fetch implementation generates automatically — this is the literal pitfall `STTClient.ts`'s header comment already documents; the same trap applies identically here.
- **Manually racing two `AbortController`s with `Promise.race`/event listeners instead of `AbortSignal.any()`:** Reinvents a now-native primitive; adds code and a place for the "if I abort A but B already fired" edge case to go wrong.
- **Extracting a premature shared `BaseHttpAdapter` class:** With exactly 2 call sites and divergent payload/response shapes (multipart-in/JSON-out vs JSON-in/binary-out), a shared base class would mostly hold a constructor (`baseUrl`, `timeoutMs`) and nothing else meaningful — not worth the indirection for two classes. Revisit only if a third raw-HTTP adapter is added later.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Combining a timeout signal with a caller-supplied signal | A manual dual-AbortController race/listener helper | `AbortSignal.any([...])` | Native, typed, zero-bug-surface; available in this repo's exact Node/TS versions (verified) |
| Multipart form construction | Manual `multipart/form-data` boundary string building | `FormData` + `fetch` (browser/Node native) | Already proven correct in `STTClient.ts`; manual boundary construction is exactly the kind of error-prone wire-format code this phase's audio-contract documentation goal is meant to prevent elsewhere |
| WAV decoding for playback | A manual WAV header parser to extract sample rate/PCM data | `AudioContext.decodeAudioData()` | Browser-native, handles the format auto-resampling that would otherwise require a custom resampler; already the established pattern in `TTSPlayer.ts` |

**Key insight:** Every "hand-roll candidate" in this phase already has a native-platform or already-proven-in-repo answer. The phase's actual engineering work is reshaping data between two already-solved problems (HTTP fetch, Web Audio decode), not solving a new hard problem.

## Common Pitfalls

### Pitfall 1: Setting Content-Type manually on a FormData body
**What goes wrong:** The multipart boundary parameter (a random string the browser generates to delimit form fields) gets omitted or malformed, and the server-side multipart parser (FastAPI/Starlette's `File(...)` handling) fails to parse the body, usually surfacing as a 422 or empty `file`.
**Why it happens:** Developers reflexively set `Content-Type` on every fetch call out of habit from JSON APIs.
**How to avoid:** Never include a `Content-Type` header when `body` is a `FormData` instance — let `fetch` compute it.
**Warning signs:** 422 Unprocessable Entity from FastAPI, or `file` arriving as `None`/empty on the Python side.

### Pitfall 2: Field name mismatch (`file` vs `audio`)
**What goes wrong:** `thonburian-stt/main.py` declares `file: UploadFile = File(...)` — the multipart field name is literally `file`. The existing `STTClient.ts` pattern uses `"audio"`. Copy-pasting that pattern without changing the field name produces a 422 (FastAPI reports the required `file` field as missing).
**Why it happens:** Pattern-matching against existing code without re-checking the actual target service's parameter name.
**How to avoid:** `form.append("file", audio, "utterance.wav")` — confirmed against the actual `thonburian-stt/main.py` source, not assumed from convention.
**Warning signs:** FastAPI 422 response body mentioning `"file"` under `"detail"` as a missing field.

### Pitfall 3: Assuming `jai-tts` honors per-call `voice`/`speed`/`language` options
**What goes wrong:** A developer wires `opts.voice`/`opts.speed` (TTS) or `opts.language` (STT) into the request body, expecting vendor-specific behavior, and is confused when output doesn't change.
**Why it happens:** The `TTSProvider`/`STTProvider` interfaces expose these options for vendor-neutrality (other vendors DO honor them), but `jai-tts` and `thonburian-stt` hardcode their behavior server-side (D-04, confirmed in both services' source).
**How to avoid:** Per D-04, silently ignore these options in the adapter — do not forward them in the request body, do not warn. Document this in the class-level doc comment so future maintainers don't "fix" it by wiring them through.
**Warning signs:** None at runtime (silent ignore is the intended behavior) — the risk is a future maintainer "fixing" this without re-reading D-04's rationale.

### Pitfall 4: Forgetting `arrayBuffer.slice(0)` before `decodeAudioData()`
**What goes wrong:** `AudioContext.decodeAudioData()` detaches (transfers) the `ArrayBuffer` it's given — any code that tries to read the same buffer afterward (e.g., for logging byte length, or a retry) throws a `TypeError: Cannot perform Construct on a detached ArrayBuffer`.
**Why it happens:** Not obvious from the API surface that `decodeAudioData` is destructive to its input.
**How to avoid:** Always pass `arrayBuffer.slice(0)` (a copy) into `decodeAudioData()`, matching `TTSPlayer.ts`'s existing pattern exactly.
**Warning signs:** Intermittent `TypeError` on detached ArrayBuffer access, especially in code paths that inspect the buffer for debugging after decode.

### Pitfall 5: `AbortSignal.timeout()`'s abort reason looks different from a manual `.abort()`
**What goes wrong:** `AbortSignal.timeout(ms)` aborts with a `TimeoutError` `DOMException` as its `.reason`, while `controller.abort()` defaults to an `AbortError` `DOMException` (or whatever reason is explicitly passed). Code that branches on `error.name === "AbortError"` (as `TTSPlayer.cancel()`'s caller does today) will NOT catch a timeout-triggered abort the same way.
**Why it happens:** The two abort sources have different default reason names by spec design — this is intentional (so callers CAN distinguish "I cancelled this" from "this timed out") but easy to overlook if you assume all aborts look the same.
**How to avoid:** Either (a) don't special-case AbortError/TimeoutError at all in these new adapters — let both normalize through the standard `error instanceof Error ? error : new Error(String(error))` path and surface as a generic failure (simplest, matches D-03's framing of timeout as "any other adapter failure"), or (b) if distinguishing is needed later, check `error.name` for both `"AbortError"` and `"TimeoutError"`.
**Warning signs:** A 60s-hung-then-timeout case being silently swallowed (if code assumes only `"AbortError"` should be swallowed) or, conversely, surfaced as an unexpected crash (if code assumes all aborts must be `"AbortError"`).

## Code Examples

### Full adapter skeleton — ThonburianSTTProvider

```typescript
// Source: composed from packages/core/src/types/pipeline.ts's STTProvider contract +
// thonburian-stt/main.py's confirmed wire shape + STTClient.ts's FormData pattern
import { STTProvider, STTResult } from "@khaveeai/core";

export interface ThonburianSTTProviderConfig {
  /** Base URL of the thonburian-stt service. Default: http://localhost:8001 */
  baseUrl?: string;
  /** Request timeout in ms (D-03). Default: 60000. */
  timeoutMs?: number;
}

export class ThonburianSTTProvider implements STTProvider {
  readonly name = "thonburian-stt";
  readonly supportsStreaming = false;
  readonly supportsRejection = false; // BACK-02 deferred — service never rejects

  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: ThonburianSTTProviderConfig = {}) {
    this.baseUrl = config.baseUrl ?? "http://localhost:8001";
    this.timeoutMs = config.timeoutMs ?? 60_000;
  }

  async transcribe(audio: Blob, _opts?: { language?: string }): Promise<STTResult> {
    // D-04: opts.language is silently ignored — thonburian-stt always transcribes as Thai.
    const form = new FormData();
    form.append("file", audio, "utterance.wav"); // field name "file", NOT "audio"

    const signal = AbortSignal.timeout(this.timeoutMs); // compose with external signal if STTProvider gains one — see Open Questions

    try {
      const res = await fetch(`${this.baseUrl}/transcribe`, {
        method: "POST",
        body: form,
        signal,
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`thonburian-stt error: ${res.status} ${body}`);
      }

      const json = (await res.json()) as { text: string };
      return { text: json.text }; // rejected omitted — supportsRejection is false
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}
```

### Full adapter skeleton — JaiTTSProvider

```typescript
// Source: composed from packages/core/src/types/pipeline.ts's TTSProvider contract +
// jai-tts/main.py's confirmed wire shape + TTSPlayer.ts's decode/playback pattern
import { TTSProvider } from "@khaveeai/core";

export interface JaiTTSProviderConfig {
  /** Base URL of the jai-tts service. Default: http://localhost:8002 */
  baseUrl?: string;
  /** Request timeout in ms (D-03). Default: 60000. */
  timeoutMs?: number;
}

export class JaiTTSProvider implements TTSProvider {
  readonly name = "jai-tts";
  readonly supportsStreaming = false;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: JaiTTSProviderConfig = {}) {
    this.baseUrl = config.baseUrl ?? "http://localhost:8002";
    this.timeoutMs = config.timeoutMs ?? 60_000;
  }

  async speak(
    text: string,
    opts: {
      audioContext: AudioContext;
      onAudioData?: (analyser: AnalyserNode, audioContext: AudioContext) => void;
      voice?: string; // D-04: silently ignored — jai-tts hardcodes its default voice
      speed?: number; // D-04: silently ignored — jai-tts hardcodes speed=1.0
      signal?: AbortSignal;
    }
  ): Promise<void> {
    if (opts.signal?.aborted) return;

    const signals: AbortSignal[] = [AbortSignal.timeout(this.timeoutMs)];
    if (opts.signal) signals.push(opts.signal);
    const combinedSignal = AbortSignal.any(signals);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: combinedSignal,
      });
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`jai-tts error: ${res.status} ${body}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const audioBuffer = await opts.audioContext.decodeAudioData(arrayBuffer.slice(0));

    const source = opts.audioContext.createBufferSource();
    source.buffer = audioBuffer;

    const analyser = opts.audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;

    source.connect(analyser);
    source.connect(opts.audioContext.destination);

    await opts.audioContext.resume();
    if (opts.audioContext.state === "running") {
      opts.onAudioData?.(analyser, opts.audioContext);
    }

    source.start();
    return new Promise<void>((resolve) => {
      source.onended = () => resolve();
    });
  }
}
```

### Round-trip test script skeleton (D-05/D-06)

```typescript
// Source: composed pattern — no existing precedent in this repo (new scripts/ convention)
// packages/providers/generic-stt-tts/scripts/roundtrip-audio-contract.ts
//
// Run manually with BOTH services started locally:
//   1. cd /Users/whitemalt/Documents/thonburian-stt && <start service on :8001>
//   2. cd /Users/whitemalt/Documents/jai-tts && <start service on :8002>
//   3. cd packages/providers/generic-stt-tts && npx vitest run scripts/roundtrip-audio-contract.ts
//
// This file is intentionally NOT matched by vitest.config.ts's `include: ["src/**/*.test.ts"]"
// so it never runs in default `pnpm test` or CI (D-06).

import { describe, it, expect } from "vitest";
import { ThonburianSTTProvider } from "../src/adapters/ThonburianSTTProvider";
import { JaiTTSProvider } from "../src/adapters/JaiTTSProvider";

describe("ADPT-03: real-service audio wire-format round trip", () => {
  it("thonburian-stt: posts a real WAV utterance and gets back Thai text", async () => {
    const provider = new ThonburianSTTProvider(); // defaults to localhost:8001
    // NOTE: build the fixture inline with a hand-written WAV-format-code-3
    // encoder (16kHz/mono/float32) — do NOT import @ricky0123/vad-web here,
    // it is not a dependency of generic-stt-tts and would break tsc. See the
    // audio wire-format doc for the exact bytes-on-the-wire spec.
    const fixtureBlob = /* encodeFloat32Wav(sineWave, 16000) as Blob */ undefined as unknown as Blob;
    const result = await provider.transcribe(fixtureBlob);
    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("jai-tts: posts text and gets back decodable 24kHz/mono/16-bit WAV", async () => {
    const provider = new JaiTTSProvider(); // defaults to localhost:8002
    // Node test environment has no real AudioContext — use a minimal fake
    // or assert on the raw fetch response directly instead of calling speak().
    // Planner's call: either (a) test the raw HTTP leg only (fetch + header
    // inspection), or (b) pull in a Node-compatible AudioContext shim.
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Manual dual-AbortController race for combining timeout + external cancellation | `AbortSignal.any([...])` static method | Baseline-widely-available since ~2024 (Node 20+, all modern browsers); confirmed typed in TypeScript 5.9.2's `lib.dom.d.ts` used by this repo | Adapters can compose D-03's internal timeout with any future external signal in one line, no custom utility needed |
| Node needing `node-fetch`/`isomorphic-fetch` for HTTP in scripts | Native global `fetch`/`FormData`/`Blob` since Node 18+ (stable, unflagged since Node 21) | Already true at this repo's observed Node v23.5.0 | The opt-in round-trip script (D-06) can run directly under Node/vitest with zero additional fetch-related dependency |

**Deprecated/outdated:**
- None directly relevant — this phase's APIs (`fetch`, `FormData`, `AbortSignal.any/timeout`) are all current, non-deprecated, stable web/Node platform features at the time of this research.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|-----------------|
| A1 | `tsx` is a reasonable choice IF the planner needs a non-vitest script runner for D-06 | Standard Stack / Supporting | Low — this is explicitly framed as a fallback option, not the primary recommendation (vitest-as-script-runner is primary, requires zero new deps); if `tsx` turns out wrong-fit, the planner can choose `ts-node` or plain `node --experimental-strip-types` instead with no architectural rework |
| A2 | `AbortSignal.timeout()`'s abort reason name is `"TimeoutError"` (distinct from manual `.abort()`'s default `"AbortError"`) | Common Pitfalls (Pitfall 5) | Low-Medium — this is standard-spec behavior (WHATWG Fetch/Streams spec), not vendor-specific, but was not independently re-verified against the exact DOMException name string in this session's Node version; if the exact string differs, only the pitfall's "how to detect" guidance (not the adapter's actual correctness) is affected, since the recommended approach (a) is to NOT special-case it at all |
| A3 | The opt-in round-trip script requires a real fixture WAV file matching 16kHz/mono/float32 format, which does not yet exist anywhere in the repo | Code Examples | Medium — if no such fixture is created as part of this phase's plan, ADPT-03's round-trip test cannot actually run end-to-end; the planner must include a task to either record one or synthesize one (e.g. via `@ricky0123/vad-web`'s own `encodeWAV` fed a generated sine wave / silence buffer) |

## Open Questions (RESOLVED)

1. **Does `STTProvider.transcribe()`'s interface need an `opts.signal` param added, or does `ThonburianSTTProvider` only ever use its own internal timeout signal?**
   - RESOLVED: No interface change. `STTProvider.transcribe()` keeps its current signature (no `opts.signal` added to Phase 1's `pipeline.ts`). `ThonburianSTTProvider` uses `AbortSignal.timeout(this.timeoutMs)` alone on the STT side — no `AbortSignal.any()` composition, no external-signal threading — staying within the phase's "No orchestrator wiring" boundary.
   - What we know: `pipeline.ts`'s current `STTProvider.transcribe(audio: Blob, opts?: { language?: string }): Promise<STTResult>` signature has NO `signal` field — only `TTSProvider.speak()` and `LLMProvider.complete()` have `opts.signal`. This appears to be intentional (whole-utterance STT calls are typically not mid-flight-cancelled the way TTS playback or LLM streaming is), not an oversight.
   - What's unclear: Whether this phase should add `opts?.signal` to `STTProvider` as an interface change (touching Phase 1's contract) or whether `ThonburianSTTProvider` should simply use `AbortSignal.timeout(this.timeoutMs)` alone with no external-signal composition for the STT side.
   - Recommendation: Treat this as in-scope for the planner to decide, but lean toward NOT modifying `pipeline.ts` in this phase — CONTEXT.md's phase boundary says "No orchestrator wiring" and modifying a Phase 1 interface is arguably orchestrator-adjacent contract work, not adapter work. `ThonburianSTTProvider` likely only needs `AbortSignal.timeout(this.timeoutMs)` alone (no `AbortSignal.any()` composition needed on the STT side at all, only on the TTS side where `opts.signal` already exists). Flag for `/gsd:discuss-phase` confirmation if the planner disagrees.

2. **What fixture audio does the round-trip test (D-05/D-06) actually POST to `thonburian-stt`?**
   - RESOLVED: Generate the fixture with a hand-written inline WAV encoder in the round-trip script itself — NOT a `@ricky0123/vad-web` import. That package is a dependency of `openai-stt-tts` only, not of `generic-stt-tts`, so importing it would fail to resolve under pnpm's strict isolation and break `tsc --noEmit`. The script builds a WAV-format-code-3 (IEEE float PCM, 1 channel, 16000 Hz, 32-bit) `Blob` from a deterministic `Float32Array`, matching the documented STT wire format. This is dev-tooling-only code, so an inline encoder is lower-risk than adding a cross-package dependency for a script.
   - What we know: It must be a real WAV blob in the 16kHz/mono/float32 format `@ricky0123/vad-web`'s `encodeWAV()` produces (per the now-documented wire format), since D-05 requires hitting the real service, not mocks.
   - What's unclear: Whether to commit a small recorded/synthesized fixture WAV file to the repo (binary asset in git) or generate one programmatically at test-run time (e.g., a short sine-wave or silence buffer encoded via the same `encodeWAV` utility, accepting that Whisper will produce a low-confidence or empty transcript for synthetic audio — which is still a valid format/round-trip proof even if the *content* assertion is loose).
   - Recommendation: Generate the fixture programmatically at test-run time via a hand-written inline WAV-format-code-3 encoder fed a deterministic `Float32Array` (e.g., a short sine wave) — avoids committing a binary fixture, avoids dependency on a specific recorded phrase, AND avoids importing `@ricky0123/vad-web` (not available to `generic-stt-tts`). The test's assertions should focus on format/structure (response is a string, request succeeds) rather than exact transcript content, since synthetic audio won't produce meaningful Thai speech.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js native `fetch`/`FormData`/`Blob` | Both adapters + round-trip script | Yes (verified via direct probe) | Node v23.5.0 | None needed |
| `AbortSignal.any()` / `AbortSignal.timeout()` | D-03 timeout composition | Yes (verified native + typed in TS 5.9.2 lib.dom.d.ts) | Native since ~2024 | None needed |
| `thonburian-stt` service running locally | D-05 round-trip test (port 8001) | Not verified running in this research session (service code exists at `/Users/whitemalt/Documents/thonburian-stt/main.py`; whether the venv/model is currently loaded was not re-checked) | — | Round-trip script is opt-in (D-06) precisely because this can't be assumed available in CI; the planner should document the manual startup step |
| `jai-tts` service running locally | D-05 round-trip test (port 8002) | Not verified running in this research session (confirmed present in `04-CONTEXT.md`: "jai-tts/venv exists with flowtts installed") | — | Same as above |
| `slopcheck` CLI | Package legitimacy audit (this research only) | Yes — already installed | unspecified (ran successfully) | N/A |
| `tsx` (conditional, D-06 fallback only) | Only if vitest-as-script-runner is rejected | Not installed as a project dependency; confirmed installable at 4.22.4 via npx | 4.22.4 (npm latest) | vitest run against an explicit script path (primary recommendation, zero new dep) |

**Missing dependencies with no fallback:**
- None — both Python services are confirmed to exist with working venvs per `04-CONTEXT.md`; their actual running-state at planning time is a runtime concern for whoever executes D-05's script, not a planning blocker.

**Missing dependencies with fallback:**
- `tsx`: fallback is to use vitest's own runner for the opt-in script — no actual gap.

## Security Domain

> `security_enforcement` was not found explicitly set to `false` in `.planning/config.json` — treating as enabled per default, but this phase's actual security surface is minimal (no auth, by explicit user decision D-01, against local-only demo services with nothing to protect).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|---------------------|
| V2 Authentication | No | D-01 explicitly removes auth — these are local, unauthenticated demo services by design; not a gap, a deliberate scoped decision already locked by the user |
| V3 Session Management | No | No session concept in this phase's HTTP calls (stateless request/response per call) |
| V4 Access Control | No | Same as V2 — no access control surface exists or is intended for local demo services |
| V5 Input Validation | Partial | The adapters themselves don't validate `text`/`audio` before sending (the backend's FastAPI/Pydantic models do their own validation, e.g. `SynthesizeRequest(BaseModel): text: str`) — no additional client-side validation is recommended beyond what TypeScript's type system already enforces (`text: string`, `audio: Blob`) |
| V6 Cryptography | No | No cryptographic operations in this phase's scope |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| Oversized audio blob sent to `thonburian-stt` causing resource exhaustion | Denial of Service | `AudioRecorder.ts` already guards this upstream (`MAX_WAV_BYTES = 24_000_000`) before the blob ever reaches an adapter — `ThonburianSTTProvider` itself does not need to re-implement this check since it only receives blobs already produced by that upstream guard, but if `ThonburianSTTProvider` is ever called directly with an arbitrary blob (bypassing `AudioRecorder`), there is currently no size guard at the adapter layer itself — worth a one-line note in the class doc comment, not necessarily a new feature this phase |
| SSRF via a maliciously-overridden `baseUrl` config pointing at an internal network resource | Tampering / Information Disclosure | Out of scope for this phase's threat model — `baseUrl` is a developer-supplied constructor config (like `endpoint` already is on the OpenAI adapters), not user/end-customer-supplied input; the existing OpenAI adapters have the identical trust assumption (developer controls `endpoint`) and this phase does not change that trust boundary |

## Sources

### Primary (HIGH confidence)
- `/Users/whitemalt/Documents/thonburian-stt/main.py` — read directly, confirms exact `/transcribe` multipart field name, response shape, hardcoded Thai-only behavior
- `/Users/whitemalt/Documents/jai-tts/main.py` — read directly, confirms exact `/synthesize` JSON request shape, raw `audio/wav` response, hardcoded voice/speed
- `/Users/whitemalt/Documents/khavee-sdk/packages/core/src/types/pipeline.ts` — read directly, the literal `STTProvider`/`TTSProvider`/`STTResult`/`LLMCompletionResult` interface contracts
- `/Users/whitemalt/Documents/khavee-sdk/packages/providers/generic-stt-tts/src/adapters/OpenAISTTAdapter.ts` and `OpenAITTSAdapter.ts` — read directly, the sibling pattern to follow
- `/Users/whitemalt/Documents/khavee-sdk/packages/providers/openai-stt-tts/src/{STTClient,TTSPlayer,AudioRecorder}.ts` — read directly, confirmed wire-format facts and FormData/decode pitfall precedents
- Direct tool execution in this session: `node -e "console.log(typeof AbortSignal.any)"` etc. confirming native global availability on Node v23.5.0; `npx tsc --showConfig`/`--noEmit` confirming default-lib DOM inclusion with no explicit `lib` array; `grep` against this repo's installed `node_modules/typescript/lib/lib.dom.d.ts` confirming `AbortSignal.any`/`AbortSignal.timeout` are typed in TypeScript 5.9.2
- `npm view tsx version` / `npm view tsx dist-tags` — direct registry query confirming `4.22.4` is latest
- `slopcheck install tsx` — direct tool execution, `[OK]` verdict

### Secondary (MEDIUM confidence)
- MDN documentation knowledge of `AbortSignal.any()`/`AbortSignal.timeout()` semantics (abort reason naming, static method behavior) — not independently re-fetched via WebFetch in this session, but cross-checked against the locally-installed `lib.dom.d.ts` type declarations which match this understanding

### Tertiary (LOW confidence)
- The exact DOMException `.name` string produced by `AbortSignal.timeout()`'s internal abort (`"TimeoutError"`) — based on spec knowledge, not independently re-verified by triggering an actual timeout in this session (see Assumptions Log A2)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies required for adapters; the one conditional dependency (`tsx`) was verified against the npm registry and slopcheck directly in this session
- Architecture: HIGH — both adapters' exact shape is dictated by already-read interface files (`pipeline.ts`) and already-read backend source (`main.py` for both services); no speculative design choices remain
- Pitfalls: HIGH — all five pitfalls are either directly observed in this session (lib resolution, AbortSignal typing) or directly transplanted from already-proven, already-shipped code in this exact repo (`STTClient.ts`, `TTSPlayer.ts`)

**Research date:** 2026-06-19
**Valid until:** 30 days (stable web/Node platform APIs; the two Python services are local and could change independently, but their wire shapes were verified directly against current source, not documentation that could drift)
