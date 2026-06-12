import { describe, it, expect } from "vitest";
import { OpenAISTTTTSProvider, OpenAISTTTTSConfig } from "../OpenAISTTTTSProvider";
import type { RealtimeProvider } from "@khaveeai/core";

/**
 * Test subclass that exposes protected internals for unit testing
 * without requiring type casts to `any`.
 */
class TestableProvider extends OpenAISTTTTSProvider {
  getMessages(): Array<{ role: "system" | "user" | "assistant"; content: string }> {
    return this.messages;
  }

  pushMessage(role: "system" | "user" | "assistant", content: string): void {
    this.messages.push({ role, content });
  }

  callTrimHistory(maxTurns?: number): void {
    this.trimHistory(maxTurns);
  }
}

// ── SDK-02: Interface conformance ───────────────────────────────────────────

describe("SDK-02: OpenAISTTTTSProvider interface conformance", () => {
  it("is assignable to RealtimeProvider and has correct initial state", () => {
    const config: OpenAISTTTTSConfig = {};
    // Compile-time check: must satisfy RealtimeProvider
    const p: RealtimeProvider = new OpenAISTTTTSProvider(config);

    expect(p.chatStatus).toBe("stopped");
    expect(p.isConnected).toBe(false);
    expect(p.conversation).toHaveLength(0);
    expect(p.currentVolume).toBe(0);
  });
});

// ── SDK-02: trimHistory preserves system message ────────────────────────────

describe("SDK-02: trimHistory preserves system message", () => {
  it("keeps the system message and trims to maxTurns*2 non-system messages", () => {
    const provider = new TestableProvider({
      instructions: "You are a test assistant.",
    });

    // Push 12 user/assistant turn pairs (24 non-system messages)
    for (let i = 0; i < 12; i++) {
      provider.pushMessage("user", `user turn ${i}`);
      provider.pushMessage("assistant", `assistant turn ${i}`);
    }

    // Before trim: 1 system + 24 non-system = 25
    expect(provider.getMessages()).toHaveLength(25);

    // Trim to default maxTurns=10 → keep 1 system + 20 non-system
    provider.callTrimHistory();

    const messages = provider.getMessages();
    // System message is preserved as first entry
    expect(messages[0].role).toBe("system");
    // Total length: 1 system + 20 non-system = 21
    expect(messages).toHaveLength(21);
  });
});

// ── SDK-04 — tests now live in STTClient.test.ts (filled by Plan 02) ─────────

// ── SDK-05 (ChatClient unit tests live in ChatClient.test.ts; provider-level
//           messages-trim tests are in Plan 04) ─────────────────────────────

// ── SDK-08 (placeholder — filled by Plan 04) ────────────────────────────────

describe.skip("SDK-08: interrupt() stops source and resets chatStatus to ready", () => {
  it.skip("aborts ttsAbortController and resets chatStatus to ready", () => {
    // filled by Plan 04
  });
});

// ── SDK-09 (placeholder — filled by Plan 04) ────────────────────────────────

describe.skip("SDK-09: onUsageReport fires with mapped token counts", () => {
  it.skip("fires onUsageReport with correct token breakdown from API response", () => {
    // filled by Plan 04
  });
});
