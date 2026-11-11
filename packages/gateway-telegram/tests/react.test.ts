/** TelegramAdapter.react — `setMessageReaction` spied on the bot's api; nothing reaches Telegram. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelegramAdapter } from "../src/adapter.js";

describe("TelegramAdapter.react", () => {
  let adapter: TelegramAdapter;
  let set: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new TelegramAdapter({ token: "fake:token" });
    set = vi.fn(async () => true);
    vi.spyOn(adapter.getBot().api, "setMessageReaction").mockImplementation(set as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it("sets the emoji reaction on the numeric chat and message", async () => {
    expect(await adapter.react("100", "7", "👀")).toEqual({ ok: true, messageId: "7" });
    expect(set).toHaveBeenCalledWith(100, 7, [{ type: "emoji", emoji: "👀" }]);
  });

  it.each([
    ["abc", "7", "👀"],
    ["100", "x", "👀"],
    ["100", "0", "👀"],
    ["100", "7", ""],
  ])("refuses %s/%s/%s without a request", async (c, m, e) => {
    const r = await adapter.react(c, m, e);
    expect(r.error?.code).toBe("invalid_reaction");
    expect(set).not.toHaveBeenCalled();
  });

  it("maps a platform refusal to a SendResult", async () => {
    set.mockRejectedValueOnce(new Error("REACTION_INVALID"));
    const r = await adapter.react("100", "7", "👀");
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
  });
});
