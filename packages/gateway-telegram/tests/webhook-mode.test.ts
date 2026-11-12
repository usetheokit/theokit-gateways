import { describe, expect, it, vi } from "vitest";
import { TelegramAdapter } from "../src/adapter.js";

function make(inbound?: "polling" | "webhook") {
  const adapter = new TelegramAdapter({ token: "fake:token", ...(inbound ? { inbound } : {}) });
  const bot = adapter.getBot();
  const init = vi.spyOn(bot, "init").mockResolvedValue(undefined);
  const start = vi.spyOn(bot, "start").mockResolvedValue(undefined);
  const stop = vi.spyOn(bot, "stop").mockResolvedValue(undefined);
  const send = vi.spyOn(bot.api, "sendMessage").mockResolvedValue({ message_id: 7 } as never);
  return { adapter, init, start, stop, send };
}

describe("TelegramAdapter inbound mode", () => {
  it("webhook: connects without polling and can send", async () => {
    const { adapter, init, start, send } = make("webhook");
    expect(await adapter.connect()).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    const r = await adapter.sendMessage({ channel: { id: "1" }, text: "hi" } as never);
    expect(r.ok).toBe(true);
    expect(send).toHaveBeenCalled();
  });

  it("default: polling starts once", async () => {
    const { adapter, start } = make();
    expect(await adapter.connect()).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    await adapter.disconnect();
  });

  it("webhook: disconnect does not call bot.stop", async () => {
    const { adapter, stop } = make("webhook");
    await adapter.connect();
    await adapter.disconnect();
    expect(stop).not.toHaveBeenCalled();
  });

  it("webhook: bad token returns false", async () => {
    const { adapter, init } = make("webhook");
    init.mockRejectedValue(new Error("bad"));
    expect(await adapter.connect()).toBe(false);
  });
});
