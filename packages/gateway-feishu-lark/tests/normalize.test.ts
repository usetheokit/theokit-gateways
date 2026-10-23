import { describe, expect, it } from "vitest";

import { normalizeLarkMessage } from "../src/normalize.js";
import { larkEvent } from "./fixtures.js";

describe("normalizeLarkMessage", () => {
  it("turns a text message into a FeishuLarkMessageEvent", () => {
    const result = normalizeLarkMessage(larkEvent(), 123);

    expect(result.kind).toBe("event");
    if (result.kind !== "event") throw new Error("unreachable");
    expect(result.event).toMatchObject({
      id: "om_1",
      platform: "feishu_lark",
      sender: { id: "ou_alice" },
      channel: { id: "oc_chat", type: "dm" },
      text: "hello",
      receivedAt: 123,
      feishu_lark: { chatId: "oc_chat", messageId: "om_1", openId: "ou_alice", eventId: "ev_1" },
    });
  });

  it("reads a group chat as a group channel", () => {
    const result = normalizeLarkMessage(larkEvent({ chatType: "group" }), 0);

    expect(result.kind === "event" && result.event.channel.type).toBe("group");
  });

  it("skips a message an app sent", () => {
    expect(normalizeLarkMessage(larkEvent({ senderType: "app" }), 0).kind).toBe("skip");
  });

  it("skips a message that is not text", () => {
    expect(normalizeLarkMessage(larkEvent({ messageType: "image" }), 0).kind).toBe("skip");
  });

  it("reports content that is not JSON instead of throwing (EC-13)", () => {
    const result = normalizeLarkMessage(larkEvent({ content: "{not json" }), 0);

    expect(result).toEqual({
      kind: "invalid",
      reason: "message om_1 has content that is not JSON",
    });
  });

  it("reports an event with no message instead of throwing", () => {
    expect(normalizeLarkMessage({ event_id: "ev_x" }, 0).kind).toBe("invalid");
  });
});
