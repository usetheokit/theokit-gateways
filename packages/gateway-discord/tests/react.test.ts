/** DiscordAdapter.react — one REST PUT on the message's own-reaction route; nothing reaches discord.com. */

import { Routes } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiscordAdapter } from "../src/adapter.js";

describe("DiscordAdapter.react", () => {
  afterEach(() => vi.restoreAllMocks());

  it("puts the URL-encoded emoji on the message", async () => {
    const adapter = new DiscordAdapter({ token: "fake-token" });
    const put = vi.fn(async () => undefined);
    vi.spyOn(adapter.getBot().rest, "put").mockImplementation(put as never);
    const r = await adapter.react("c1", "m1", "👀");
    expect(r).toEqual({ ok: true, messageId: "m1" });
    expect(put).toHaveBeenCalledWith(Routes.channelMessageOwnReaction("c1", "m1", "%F0%9F%91%80"));
  });

  it("refuses an empty emoji without a request", async () => {
    const adapter = new DiscordAdapter({ token: "fake-token" });
    const put = vi.fn();
    vi.spyOn(adapter.getBot().rest, "put").mockImplementation(put as never);
    const r = await adapter.react("c1", "m1", "");
    expect(r.error?.code).toBe("invalid_reaction");
    expect(put).not.toHaveBeenCalled();
  });
});
