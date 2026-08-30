/**
 * Tests for DiscordAdapter (T6.1, EC-C default intents).
 *
 * Unit tests cover the bits that don't require a real Discord API
 * connection. There is currently NO integration coverage: the manual probe
 * this comment used to point at lived under `examples/`, which was removed on
 * 2026-08-17, and it pointed at a path that had already stopped existing.
 */

import { GatewayIntentBits } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DISCORD_INTENTS, DiscordAdapter } from "../src/adapter.js";

/** A minimal normalized event, for driving the internal dispatch seam. */
function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    platform: "discord",
    sender: { id: "u1" },
    channel: { id: "c1", type: "group" },
    text: "hi",
    receivedAt: 1_700_000_000_000,
    discord: { guildId: "g1", channelId: "c1", authorId: "u1", messageId: "msg-1" },
    ...overrides,
  } as unknown as Parameters<DiscordAdapter["dispatchEvent"]>[0];
}

describe("DiscordAdapter (T6.1)", () => {
  let adapter: DiscordAdapter;

  beforeEach(() => {
    adapter = new DiscordAdapter({ token: "fake-token" });
  });

  afterEach(async () => {
    await adapter.disconnect();
    vi.restoreAllMocks();
  });

  it("platform is 'discord'", () => {
    expect(adapter.platform).toBe("discord");
  });

  it("EC-C: default intents include MessageContent (silent-failure guard)", () => {
    expect(DEFAULT_DISCORD_INTENTS).toContain(GatewayIntentBits.MessageContent);
    expect(DEFAULT_DISCORD_INTENTS).toContain(GatewayIntentBits.Guilds);
    expect(DEFAULT_DISCORD_INTENTS).toContain(GatewayIntentBits.GuildMessages);
  });

  it("EC-C: passing intents:[] logs a warn", () => {
    const writes: string[] = [];
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((s: string | Uint8Array) => {
        writes.push(typeof s === "string" ? s : Buffer.from(s).toString("utf8"));
        return true;
      });
    new DiscordAdapter({ token: "fake-token", intents: [] });
    expect(writes.join("")).toContain("intents:[]");
    stderr.mockRestore();
  });

  it("sendMessage with empty text returns error", async () => {
    const r = await adapter.sendMessage({
      channel: { id: "123", type: "dm" },
      text: "",
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("empty_text");
  });

  it("EC-H: onInbound second call replaces the previous handler", async () => {
    let firstCalls = 0;
    let secondCalls = 0;
    adapter.onInbound(async () => {
      firstCalls += 1;
    });
    adapter.onInbound(async () => {
      secondCalls += 1;
    });

    // This used to assert both counters were 0, with a comment conceding "the
    // contract is tested by inspection". Nothing was tested: 0 and 0 hold
    // whether onInbound replaces, stacks, or discards. A regression to
    // `handlers.push(handler)` would have the agent reply TWICE to every
    // message — double-billing tokens — and this test would still pass.
    //
    // `dispatchEvent` is the internal seam that makes it answerable without
    // synthesizing a discord.js Message.
    await adapter.dispatchEvent(makeEvent());

    expect(firstCalls).toBe(0);
    expect(secondCalls).toBe(1);
  });

  it("the unsubscribe from a replaced handler does not silence the live one", async () => {
    let firstCalls = 0;
    let secondCalls = 0;
    const offFirst = adapter.onInbound(async () => {
      firstCalls += 1;
    });
    adapter.onInbound(async () => {
      secondCalls += 1;
    });

    offFirst(); // stale
    await adapter.dispatchEvent(makeEvent());

    expect(firstCalls).toBe(0);
    expect(secondCalls).toBe(1);
  });

  it("reports no_handler once the live handler unsubscribes", async () => {
    const off = adapter.onInbound(async () => {});
    off();
    expect(await adapter.dispatchEvent(makeEvent())).toBe("no_handler");
  });

  it("disconnect is idempotent on never-connected", async () => {
    await adapter.disconnect();
    await adapter.disconnect();
    expect(adapter.platform).toBe("discord");
  });

  it("connect() with bad token returns false (does NOT throw)", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await adapter.connect();
    expect(result).toBe(false);
    stderr.mockRestore();
  }, 30_000);
});

describe("DiscordAdapter — a throwing handler", () => {
  it("names the handler as the source, not the platform client", async () => {
    // The rejection used to escape into the platform's own error channel, and the adapter reported
    // it as a client/bot error — so a bug in the consumer's handler read as a fault in
    // discord.js/grammy, sending whoever debugged it to the wrong repository (#41).
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const adapter = new DiscordAdapter({ token: "fake-token" });
    adapter.onInbound(async () => {
      throw new Error("user handler blew up");
    });

    await expect(adapter.dispatchEvent(makeEvent())).resolves.toBe("handler_threw");

    const written = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("[discord] handler threw: user handler blew up");
    stderr.mockRestore();
  });
});

describe("DiscordAdapter — the format the caller declared", () => {
  /**
   * Discord's new code shipped with zero tests and two defects, both found in review. Its
   * byte-identical Mattermost twin had tests and both defects were visible there — which is
   * the argument for these existing at all.
   */
  function adapterSending(sent: string[]) {
    const adapter = new DiscordAdapter({ token: "t" });
    const channel = {
      isTextBased: () => true,
      send: async ({ content }: { content: string }) => {
        sent.push(content);
        return { id: `m${sent.length}` };
      },
    };
    (adapter as unknown as { client: unknown }).client = {
      channels: { fetch: async () => channel },
    };
    (adapter as unknown as { connected: boolean }).connected = true;
    return adapter;
  }

  it("escapes markdown when the caller declares plain", async () => {
    const sent: string[] = [];
    await adapterSending(sent).sendMessage({
      channel: { id: "c1", type: "group" },
      text: "literal *asterisks*",
      format: "plain",
    });

    expect(sent[0]).toBe("literal \\*asterisks\\*");
  });

  it("escapes a backslash the caller already typed, before the markers it guards", async () => {
    // The inversion found in review: without escaping `\` first, `a\*b` becomes `a\\*b`, the
    // renderer eats `\\` as one literal backslash, and the `*` it guarded is left bare — so
    // text sent as `plain` arrives italicised.
    const sent: string[] = [];
    await adapterSending(sent).sendMessage({
      channel: { id: "c1", type: "group" },
      text: "a\\*b",
      format: "plain",
    });

    expect(sent[0]).toBe("a\\\\\\*b");
  });

  it("sends markdown untouched, because the platform parses it natively", async () => {
    const sent: string[] = [];
    await adapterSending(sent).sendMessage({
      channel: { id: "c1", type: "group" },
      text: "**bold**",
      format: "markdown",
    });

    expect(sent[0]).toBe("**bold**");
  });

  it("never cuts an escape pair across a message boundary", async () => {
    // Escaping before splitting inflates the string, so the hard window cut can land between a
    // backslash and its character: message 1 ends in a stray backslash the user never typed and
    // message 2 opens with a bare marker. Split first, escape per chunk.
    const sent: string[] = [];
    await adapterSending(sent).sendMessage({
      channel: { id: "c1", type: "group" },
      text: `${"x".repeat(1899)}*bold*${"y".repeat(300)}`,
      format: "plain",
    });

    expect(sent.length).toBeGreaterThan(1);
    for (const [i, chunk] of sent.entries()) {
      const trailing = /\\+$/.exec(chunk)?.[0].length ?? 0;
      expect(trailing % 2, `message ${i + 1} ends mid-escape-pair`).toBe(0);
    }
  });
});
