import type { MessageEvent as GatewayMessageEvent } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { LineAdapter } from "../src/adapter.js";
import { lineEventToMessageEvent } from "../src/normalize.js";
import type { LineWebhookEvent } from "../src/types.js";

const BOT = "Ubot";

function lineEvent(source: "user" | "group", mentionees: string[]): GatewayMessageEvent {
  const raw: LineWebhookEvent = {
    type: "message",
    timestamp: 1,
    replyToken: "rt",
    source:
      source === "user"
        ? { type: "user", userId: "Usender" }
        : { type: "group", groupId: "Cgroup", userId: "Usender" },
    message: {
      type: "text",
      id: "m1",
      text: "hello",
      mentionees: mentionees.map((userId) => ({ index: 0, length: 1, userId })),
    },
  };
  const event = lineEventToMessageEvent(raw);
  if (event === undefined) throw new Error("fixture did not normalize");
  return event;
}

function build(requireMention: boolean, botUserId?: string) {
  const adapter = new LineAdapter({
    channelSecret: "s",
    channelAccessToken: "t",
    requireMention,
    ...(botUserId === undefined ? {} : { botUserId }),
  });
  const received: GatewayMessageEvent[] = [];
  adapter.onInbound(async (event) => {
    received.push(event);
  });
  return { adapter, received };
}

describe("LineAdapter.deliver mention gating (FR-002, FR-003, FR-007)", () => {
  it("does not deliver an unmentioned group event when requireMention is true, and answers ok", async () => {
    const { adapter, received } = build(true, BOT);
    expect(await adapter.deliver(lineEvent("group", []))).toBe("ok");
    expect(received).toHaveLength(0);
  });

  it("delivers an unmentioned group event once when requireMention is false", async () => {
    const { adapter, received } = build(false, BOT);
    expect(await adapter.deliver(lineEvent("group", []))).toBe("ok");
    expect(received).toHaveLength(1);
  });

  it("delivers a group event that mentions the bot once in both modes", async () => {
    for (const mode of [true, false]) {
      const { adapter, received } = build(mode, BOT);
      await adapter.deliver(lineEvent("group", [BOT]));
      expect(received).toHaveLength(1);
    }
  });

  it("delivers a DM once in both modes", async () => {
    for (const mode of [true, false]) {
      const { adapter, received } = build(mode, BOT);
      await adapter.deliver(lineEvent("user", []));
      expect(received).toHaveLength(1);
    }
  });

  it("answers ok for a dropped event with no handler subscribed", async () => {
    const adapter = new LineAdapter({
      channelSecret: "s",
      channelAccessToken: "t",
      requireMention: true,
      botUserId: BOT,
    });
    expect(await adapter.deliver(lineEvent("group", []))).toBe("ok");
  });

  it("delivers an unmentioned group event when botUserId is unset (guard off)", async () => {
    const { adapter, received } = build(true);
    await adapter.deliver(lineEvent("group", []));
    expect(received).toHaveLength(1);
  });
});
