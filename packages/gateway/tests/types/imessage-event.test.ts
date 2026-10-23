/**
 * `imessage` is a first-party platform (B-355, plan ADR D1).
 *
 * These assertions run under `tsc`, which the package's `test` script runs before vitest: an
 * assignment that does not type-check fails the suite even though vitest itself strips types.
 */

import { describe, expect, it } from "vitest";

import type { IMessageMessageEvent, MessageEvent, PlatformName } from "../../src/index.js";

function makeIMessageEvent(): MessageEvent {
  return {
    id: "im-1",
    platform: "imessage",
    sender: { id: "+5511999999999" },
    channel: { id: "42", type: "group" },
    text: "hi",
    receivedAt: 0,
    imessage: {
      chatId: 42,
      guid: "p:0/ABC-123",
      isGroup: true,
      participants: ["+5511999999999", "+5511888888888"],
      raw: {},
    },
  };
}

describe("IMessageMessageEvent", () => {
  it("names imessage as a platform", () => {
    const name: PlatformName = "imessage";

    expect(name).toBe("imessage");
  });

  it("narrows to the imessage variant on its discriminator", () => {
    const event = makeIMessageEvent();
    if (event.platform !== "imessage") throw new Error("unreachable");
    const narrowed: IMessageMessageEvent = event;
    const chatId: number = narrowed.imessage.chatId;

    expect(chatId).toBe(42);
    expect(narrowed.imessage.isGroup).toBe(true);
    expect(narrowed.imessage.participants).toHaveLength(2);
  });
});
