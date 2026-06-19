# Phase 4: Vendor Adapters & Audio Contract - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-19
**Phase:** 4-Vendor Adapters & Audio Contract
**Areas discussed:** Adapter connection config, Request timeout for CPU inference, Unsupported options handling, Round-trip test strategy

---

## Adapter connection config

| Option | Description | Selected |
|--------|-------------|----------|
| Drop auth entirely | Constructor takes only `{ baseUrl?: string }`. Matches reality — no secret to hide. | ✓ |
| Keep authToken as optional, unused field | Match OpenAI adapters' `{endpoint, authToken}` shape for consistency. | |
| You decide | Let Claude pick. | |

**User's choice:** Drop auth entirely
**Notes:** —

| Option | Description | Selected |
|--------|-------------|----------|
| Default to localhost ports | `new ThonburianSTTProvider()` works out of the box (localhost:8001/8002). | ✓ |
| Required, no default | Forces explicit baseUrl every time. | |
| You decide | Let Claude pick. | |

**User's choice:** Default to localhost ports
**Notes:** —

---

## Request timeout for CPU inference

| Option | Description | Selected |
|--------|-------------|----------|
| Configurable timeout, generous default | Add `timeoutMs` via `AbortSignal.timeout()` so a hung backend doesn't stall forever. | ✓ |
| No timeout (matches existing pattern) | Stay consistent with STTClient/TTSPlayer, which have none. | |
| You decide | Let Claude pick. | |

**User's choice:** Configurable timeout, generous default
**Notes:** —

| Option | Description | Selected |
|--------|-------------|----------|
| 60 seconds | Generous enough for short voice-turn utterances on CPU fallback. | ✓ |
| 120 seconds | More headroom, slower failure signal. | |
| You decide | Let Claude pick. | |

**User's choice:** 60 seconds
**Notes:** —

---

## Unsupported options handling

| Option | Description | Selected |
|--------|-------------|----------|
| Silently ignore | Matches the existing best-effort `signal` pattern (Phase 2 D-01/D-02). | ✓ |
| console.warn once when set | Surfaces the mismatch for developers porting code from the OpenAI adapter. | |
| You decide | Let Claude pick. | |

**User's choice:** Silently ignore
**Notes:** Covers thonburian-stt's hardcoded Thai language and jai-tts's hardcoded default voice + speed=1.0.

---

## Round-trip test strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Real local services | Hits the actual running thonburian-stt/jai-tts; proves real byte-format compatibility. | ✓ |
| Fixture audio + mocked HTTP | Fast/CI-friendly but only tests SDK-side logic. | |
| You decide | Let Claude pick. | |

**User's choice:** Real local services
**Notes:** Both services' venvs/models already confirmed installed locally during this discussion.

| Option | Description | Selected |
|--------|-------------|----------|
| Separate opt-in script | Standalone script outside the default vitest suite; documented, never runs in CI. | ✓ |
| Gated by env var inside the test suite | Lives in `__tests__`, self-skips unless an env var is set. | |
| You decide | Let Claude pick. | |

**User's choice:** Separate opt-in script
**Notes:** —

---

## Claude's Discretion

- Exact file/class naming beyond `ThonburianSTTProvider`/`JaiTTSProvider`
- Whether to extract a tiny shared HTTP helper across the two new adapters, vs. a custom `fetch()` per adapter
- Exact location/format of the audio wire-format documentation (doc comment vs. README section)
- `supportsStreaming`/`supportsRejection` capability flags (both `false`, not actually in question)
- Exact location of the opt-in round-trip test script within the package

## Deferred Ideas

None — discussion stayed within phase scope.
