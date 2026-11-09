/** Two adapters of one platform: a reply leaves through the adapter that received the event. */
import { describe, expect, it } from "vitest";

import { GatewayRunner } from "../../src/runner/gateway-runner.js";
import type { MessageEvent } from "../../src/types/message-event.js";
import { MockAdapter } from "../adapter/mock-adapter.js";

const ev: MessageEvent = {
  id: "tg-1",
  platform: "telegram",
  sender: { id: "100" },
  channel: { id: "1", type: "dm" },
  text: "hi",
  receivedAt: 0,
  telegram: { chatId: 1, messageId: 1, raw: {} },
};

describe("two adapters of one platform", () => {
  it("replies through the adapter that received the event and stops both", async () => {
    const a = new MockAdapter("telegram");
    const b = new MockAdapter("telegram");
    const runner = new GatewayRunner({
      adapters: [a, b],
      handler: async (_e, ctx) => {
        await ctx.reply("pong");
      },
    });
    await runner.start();
    await b.emit(ev);
    await a.emit(ev);
    await runner.stop();
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
  });
});
