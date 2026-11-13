import { type BasePlatformAdapter, channelRendering, type OutboundMessage } from "@theokit/gateway";
import { ChatPresenter } from "@theokit/presenter";
import { describe, expect, it } from "vitest";

import { deliverText } from "../src/index.js";

function fake(
  send: (m: OutboundMessage) => Promise<unknown>,
  platform = "slack",
): BasePlatformAdapter {
  return { platform, sendMessage: send } as unknown as BasePlatformAdapter;
}

const TEXT = "**bold** and _it_";

describe("deliverText", () => {
  it("sends what ChatPresenter with channelRendering produces", async () => {
    const sent: OutboundMessage[] = [];
    const adapter = fake(async (m) => {
      sent.push(m);
      return { ok: true, messageId: "m1" };
    });
    expect(await deliverText(adapter, "C1", TEXT)).toBeUndefined();

    const presenter = new ChatPresenter({
      channel: { id: "C1", type: "dm" },
      ...channelRendering("slack"),
    });
    presenter.present({ type: "text", text: TEXT });
    const expected = presenter.present({ type: "finish" });
    expect(expected).toHaveLength(1);
    expect(sent).toEqual(expected);
  });

  it("returns the refusal code", async () => {
    const adapter = fake(async () => ({
      ok: false,
      error: { code: "rate_limited", message: "secret" },
    }));
    expect(await deliverText(adapter, "C1", TEXT)).toBe("rate_limited");
  });

  it("returns only the error name when the adapter throws", async () => {
    const adapter = fake(async () => {
      throw new TypeError("secret id 123");
    });
    expect(await deliverText(adapter, "C1", TEXT)).toBe("TypeError");
  });
});
