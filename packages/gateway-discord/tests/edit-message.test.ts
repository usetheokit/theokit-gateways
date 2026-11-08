/**
 * DiscordAdapter.editMessage — replaces a sent message's text with one REST PATCH.
 *
 * The edit is the request `channel.messages.edit` makes, sent without fetching the channel, so a
 * success is one request whatever the channel cache holds (plan D6). Every platform call is a spy
 * on the client's own `rest` and `channels` objects; nothing reaches discord.com. The E1 to E7
 * labels are the plan's shared edit behaviours (gateway-preview-streaming, Phase 2).
 */

import type { OutboundMessage } from "@theokit/gateway";
import { DiscordAPIError, Events, Routes } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DiscordAdapter } from "../src/adapter.js";
import { splitForDiscord } from "../src/split.js";

const CHANNEL = { id: "c1", type: "group" } as const;

function discordError(code: number, status: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: `refused with ${code}` },
    code,
    status,
    "PATCH",
    "https://discord.com/api/v10/channels/c1/messages/m1",
    { body: undefined, files: undefined },
  );
}

/** The largest text length `splitForDiscord` still returns as one part, read from the splitter. */
function singlePartLimit(): number {
  let fits = 1;
  let splits = 1_000_000;
  while (splits - fits > 1) {
    const mid = Math.floor((fits + splits) / 2);
    if (splitForDiscord("a".repeat(mid)).length === 1) fits = mid;
    else splits = mid;
  }
  return fits;
}

describe("DiscordAdapter.editMessage", () => {
  let adapter: DiscordAdapter;
  let patch: ReturnType<typeof vi.fn>;
  let fetchChannel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new DiscordAdapter({ token: "fake-token" });
    patch = vi.fn(async () => ({ id: "m1" }));
    fetchChannel = vi.fn(async () => null);
    vi.spyOn(adapter.getBot().rest, "patch").mockImplementation(patch as never);
    vi.spyOn(adapter.getBot().channels, "fetch").mockImplementation(fetchChannel as never);
  });

  afterEach(async () => {
    await adapter.disconnect();
    vi.restoreAllMocks();
  });

  const out = (text: string, format?: OutboundMessage["format"]): OutboundMessage => ({
    channel: CHANNEL,
    text,
    ...(format !== undefined ? { format } : {}),
  });

  it("reports supportsEdit as true before and after connect (E1)", async () => {
    expect(adapter.supportsEdit).toBe(true);
    const client = adapter.getBot();
    vi.spyOn(client, "login").mockImplementation(async () => {
      client.emit(Events.ClientReady, client as never);
      return "fake-token";
    });
    vi.spyOn(client, "destroy").mockResolvedValue(undefined);
    expect(await adapter.connect()).toBe(true);
    expect(adapter.supportsEdit).toBe(true);
  });

  it("edits a sent message with one PATCH and no channel fetch (E2)", async () => {
    const result = await adapter.editMessage("m1", out("hello"));

    expect(result).toEqual({ ok: true, messageId: "m1" });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(Routes.channelMessage("c1", "m1"), {
      body: { content: "hello" },
    });
    expect(fetchChannel).toHaveBeenCalledTimes(0);
  });

  it("edits in one request whatever the channel cache holds", async () => {
    adapter.getBot().channels.cache.clear();

    await adapter.editMessage("m1", out("hello"));

    expect(patch).toHaveBeenCalledTimes(1);
    expect(fetchChannel).toHaveBeenCalledTimes(0);
  });

  it("refuses a text the splitter would cut in two as edit_too_long with no request (E3)", async () => {
    const limit = singlePartLimit();

    const tooLong = await adapter.editMessage("m1", out("a".repeat(limit + 1)));
    expect(tooLong.ok).toBe(false);
    expect(tooLong.error?.code).toBe("edit_too_long");
    expect(patch).toHaveBeenCalledTimes(0);

    const atLimit = await adapter.editMessage("m1", out("a".repeat(limit)));
    expect(atLimit).toEqual({ ok: true, messageId: "m1" });
    expect(patch).toHaveBeenCalledTimes(1);
  });

  // The splitter measures the caller's text, but a `plain` text is escaped after the split and
  // every `*` becomes `\*`. 995 copies of `*a` are 1990 characters (one part) and 2985 escaped,
  // which Discord would refuse with 50035 after the request instead of the edit_too_long E3 promises.
  it("refuses a plain text whose escaped body passes 2000 characters with no request", async () => {
    const result = await adapter.editMessage("m1", out("*a".repeat(995), "plain"));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("edit_too_long");
    expect(patch).toHaveBeenCalledTimes(0);
  });

  // The edit refuses exactly the texts a send delivers as more than one message, and its refusal
  // names how many, so a caller falling back to sendMessage knows what the send will do.
  it("names the message count a send of the escaped text needs when it refuses the edit", async () => {
    const result = await adapter.editMessage("m1", out("*a".repeat(995), "plain"));

    expect(result.error?.message).toBe("text needs 3 Discord messages; an edit replaces one");
  });

  // One character past the cap once escaped: 1000 `*` escape to exactly 2000, the trailing `a`
  // makes 2001.
  it("refuses a plain text whose escaped body is 2001 characters with no request", async () => {
    const result = await adapter.editMessage("m1", out(`${"*".repeat(1000)}a`, "plain"));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("edit_too_long");
    expect(patch).toHaveBeenCalledTimes(0);
  });

  it("edits a plain text whose escaped body is exactly 2000 characters", async () => {
    const result = await adapter.editMessage("m1", out("*".repeat(1000), "plain"));

    expect(result).toEqual({ ok: true, messageId: "m1" });
    expect(patch).toHaveBeenCalledWith(Routes.channelMessage("c1", "m1"), {
      body: { content: "\\*".repeat(1000) },
    });
  });

  it.each([
    [10008, 404, "discord_10008"],
    [10003, 404, "discord_10003"],
    [50005, 403, "discord_50005"],
    [50013, 403, "no_permission"],
    [0, 429, "rate_limited"],
    [50035, 400, "discord_50035"],
  ])(
    "maps a %i refusal through the send-error mapping without throwing (E4)",
    async (code, status, mapped) => {
      patch.mockRejectedValueOnce(discordError(code, status));

      const result = await adapter.editMessage("m1", out("hello"));

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe(mapped);
      expect(patch).toHaveBeenCalledTimes(1);
    },
  );

  it("refuses empty text as empty_text with no request (E5)", async () => {
    const result = await adapter.editMessage("m1", out(""));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("empty_text");
    expect(patch).toHaveBeenCalledTimes(0);
  });

  it("edits a whitespace-only text as sendMessage would send it (E5, split rule)", async () => {
    const result = await adapter.editMessage("m1", out("   "));
    expect(result).toEqual({ ok: true, messageId: "m1" });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(Routes.channelMessage("c1", "m1"), {
      body: { content: "   " },
    });
  });

  it("refuses an empty message id as invalid_message_id with no request (E6)", async () => {
    const result = await adapter.editMessage("", out("hello"));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_message_id");
    expect(patch).toHaveBeenCalledTimes(0);
  });

  it.each([
    ["plain", "\\*hi\\*"],
    ["markdown", "*hi*"],
  ] as const)(
    "applies format %s to the content as the send path does (E7)",
    async (format, content) => {
      await adapter.editMessage("m1", out("*hi*", format));
      expect(patch).toHaveBeenCalledWith(Routes.channelMessage("c1", "m1"), { body: { content } });
    },
  );

  it("answers a REST call that throws a plain error as unknown without throwing", async () => {
    patch.mockRejectedValueOnce(new Error("Expected token to be set for this request"));

    const result = await adapter.editMessage("m1", out("hello"));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("unknown");
  });
});

describe("DiscordAdapter.editMessage attachments (B-674)", () => {
  let adapter: DiscordAdapter;

  beforeEach(() => {
    adapter = new DiscordAdapter({ token: "fake-token" });
  });

  afterEach(async () => {
    await adapter.disconnect();
    vi.restoreAllMocks();
  });

  it("refuses an edit that carries an image with no platform call", async () => {
    const patch = vi.fn(async () => ({ id: "m1" }));
    vi.spyOn(adapter.getBot().rest, "patch").mockImplementation(patch as never);

    const result = await adapter.editMessage("m1", {
      channel: CHANNEL,
      text: "hello",
      attachments: [{ kind: "image", mediaType: "image/png", data: new Uint8Array([1]) }],
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("attachments_unsupported");
    expect(patch).toHaveBeenCalledTimes(0);
  });
});
