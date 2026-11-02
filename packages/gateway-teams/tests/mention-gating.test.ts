import type { MessageEvent } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { TeamsAdapter } from "../src/adapter.js";
import { normalizeTeamsActivity } from "../src/normalize.js";

const BOT_ID = "28:bot-id";

function activity(
  conversationType: string,
  entities: ReadonlyArray<unknown> | undefined,
  recipientId: string | undefined = BOT_ID,
): MessageEvent {
  return normalizeTeamsActivity({
    type: "message",
    id: "act-1",
    text: "hello",
    conversation: { id: "conv-1", conversationType },
    from: { id: "u1" },
    ...(recipientId === undefined ? {} : { recipient: { id: recipientId } }),
    ...(entities === undefined ? {} : { entities }),
  });
}

const mentionOf = (id: string) => ({ type: "mention", mentioned: { id } });

function build(requireMention?: boolean) {
  const adapter = new TeamsAdapter({
    clientId: "client-1",
    clientSecret: "secret-1",
    tenantId: "tenant-1",
    ...(requireMention === undefined ? {} : { requireMention }),
  });
  const received: MessageEvent[] = [];
  adapter.onInbound(async (event) => {
    received.push(event);
  });
  return { adapter, received };
}

describe("TeamsAdapter.deliver mention gating (FR-001 to FR-003, FR-006)", () => {
  it("does not deliver an unmentioned groupChat event and answers ok", async () => {
    const { adapter, received } = build(true);
    expect(await adapter.deliver(activity("groupChat", []))).toBe("ok");
    expect(received).toHaveLength(0);
  });

  it("gates by default, because requireMention defaults to true", async () => {
    const { adapter, received } = build();
    await adapter.deliver(activity("groupChat", undefined));
    expect(received).toHaveLength(0);
  });

  it("delivers the same event once when requireMention is false", async () => {
    const { adapter, received } = build(false);
    await adapter.deliver(activity("groupChat", []));
    expect(received).toHaveLength(1);
  });

  it("delivers an event with an entity mentioning recipient.id once in both modes", async () => {
    for (const mode of [true, false]) {
      const { adapter, received } = build(mode);
      await adapter.deliver(activity("groupChat", [mentionOf(BOT_ID)]));
      expect(received).toHaveLength(1);
    }
  });

  it("does not deliver an event whose only mention names another user", async () => {
    const { adapter, received } = build(true);
    await adapter.deliver(activity("channel", [mentionOf("29:someone-else")]));
    expect(received).toHaveLength(0);
  });

  it("answers ok for a dropped event with no handler subscribed", async () => {
    const adapter = new TeamsAdapter({
      clientId: "client-1",
      clientSecret: "secret-1",
      tenantId: "tenant-1",
    });
    expect(await adapter.deliver(activity("groupChat", []))).toBe("ok");
  });

  it("delivers a personal conversation once in both modes", async () => {
    for (const mode of [true, false]) {
      const { adapter, received } = build(mode);
      await adapter.deliver(activity("personal", []));
      expect(received).toHaveLength(1);
    }
  });
});
