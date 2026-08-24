/**
 * Tests for TelegramAdapter (T5.1, EC-H/I/K).
 *
 * Unit tests focus on the bits that don't require a real Telegram API
 * connection: empty-text validation, EC-K bot-filter, EC-H handler
 * replacement, EC-I invalid-token recovery. Real send-path coverage
 * comes from the telegram-pro dogfood (Phase 10).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelegramAdapter } from "../src/adapter.js";

/** A minimal normalized event, for driving the internal dispatch seam. */
function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "1",
    platform: "telegram",
    sender: { id: "42" },
    channel: { id: "100", type: "dm" },
    text: "hi",
    receivedAt: 1_700_000_000_000,
    telegram: { chatId: 100, messageId: 1, fromId: 42 },
    ...overrides,
  } as unknown as Parameters<TelegramAdapter["dispatchEvent"]>[0];
}

describe("TelegramAdapter (T5.1)", () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    adapter = new TelegramAdapter({ token: "fake:token" });
  });

  afterEach(async () => {
    await adapter.disconnect();
    vi.restoreAllMocks();
  });

  it("platform is 'telegram'", () => {
    expect(adapter.platform).toBe("telegram");
  });

  it("sendMessage with empty text returns error, does not throw", async () => {
    const r = await adapter.sendMessage({
      channel: { id: "100", type: "dm" },
      text: "",
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("empty_text");
  });

  it("sendMessage with non-numeric channel.id returns invalid_channel error", async () => {
    const r = await adapter.sendMessage({
      channel: { id: "not-a-number", type: "dm" },
      text: "hi",
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("invalid_channel");
  });

  it("EC-H: onInbound second call replaces handler", async () => {
    const calls: string[] = [];
    adapter.onInbound(async () => {
      calls.push("first");
    });
    adapter.onInbound(async () => {
      calls.push("second");
    });

    // This used to assert `calls` was empty, under a comment explaining that
    // the direct call was skipped and "covered by integration in the dogfood".
    // An empty array holds whether onInbound replaces, stacks, or discards —
    // the assertion could not fail. `dispatchEvent` is the internal seam that
    // makes the contract answerable without a grammy Context.
    await adapter.dispatchEvent(makeEvent());

    expect(calls).toEqual(["second"]);
  });

  it("the unsubscribe from a replaced handler does not silence the live one", async () => {
    const calls: string[] = [];
    const offFirst = adapter.onInbound(async () => {
      calls.push("first");
    });
    adapter.onInbound(async () => {
      calls.push("second");
    });

    offFirst(); // stale
    await adapter.dispatchEvent(makeEvent());

    expect(calls).toEqual(["second"]);
  });

  it("reports no_handler once the live handler unsubscribes", async () => {
    const off = adapter.onInbound(async () => {});
    off();
    expect(await adapter.dispatchEvent(makeEvent())).toBe("no_handler");
  });

  it("EC-I: connect() resolves to false when init fails (does NOT throw)", async () => {
    // This asserted the same contract by calling the REAL Telegram API with a bogus token and
    // waiting for the 401 (B-014). A unit test that needs api.telegram.org fails when the network is
    // slow and passes when a proxy answers, and it did — found while running the gates for a
    // type-level change in a different package.
    //
    // The behaviour worth covering is `init() rejects -> connect() returns false`, and the rejection
    // is what a bogus token was being used to produce. Producing it directly is the same assertion
    // in milliseconds, and it also covers the failures a bad token never reaches: a DNS failure, a
    // 500, a socket reset.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const init = vi
      .spyOn(adapter.getBot(), "init")
      .mockRejectedValue(new Error("Call to 'getMe' failed! (401: Unauthorized)"));

    try {
      expect(await adapter.connect()).toBe(false);
      expect(init).toHaveBeenCalledOnce();
      expect(stderr.mock.calls.map(String).join("")).toContain("connect failed");
    } finally {
      init.mockRestore();
      stderr.mockRestore();
    }
  });

  it("disconnect is idempotent on never-connected", async () => {
    await adapter.disconnect();
    await adapter.disconnect();
    // Test passes if no throw.
    expect(adapter.platform).toBe("telegram");
  });

  it("startTyping with non-numeric id is a noop (does NOT throw)", async () => {
    await adapter.startTyping("not-numeric");
    expect(adapter.platform).toBe("telegram");
  });
});

describe("TelegramAdapter — a throwing handler", () => {
  it("names the handler as the source, not the platform client", async () => {
    // The rejection used to escape into the platform's own error channel, and the adapter reported
    // it as a client/bot error — so a bug in the consumer's handler read as a fault in
    // telegram.js/grammy, sending whoever debugged it to the wrong repository (#41).
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const adapter = new TelegramAdapter({ token: "fake:token" });
    adapter.onInbound(async () => {
      throw new Error("user handler blew up");
    });

    await expect(adapter.dispatchEvent(makeEvent())).resolves.toBe("handler_threw");

    const written = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("[telegram] handler threw: user handler blew up");
    stderr.mockRestore();
  });
});
