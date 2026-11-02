/**
 * The live Discord inbound probe posts an UNMENTIONED message into a guild channel and waits for
 * it. That probe tests transport — the websocket and the MessageContent intent — not mention
 * gating, so the adapter it builds must deliver a group message nobody mentioned the bot in.
 * This runs offline: the bot id is stood in, and the event is handed to `deliver()`.
 */

import type { MessageEvent } from "@theokit/gateway";
import { DiscordAdapter } from "@theokit/gateway-discord";
import { describe, expect, it } from "vitest";

import { inboundProbeAdapter } from "../discord/inbound-probe-adapter.js";

async function deliveredCount(adapter: DiscordAdapter): Promise<number> {
  (adapter.getBot() as unknown as { user: { id: string } }).user = { id: "999" };
  const delivered: MessageEvent[] = [];
  adapter.onInbound(async (event) => {
    delivered.push(event);
  });
  await adapter.deliver(unmentionedGroupEvent());
  return delivered.length;
}

describe("inboundProbeAdapter", () => {
  it("delivers an unmentioned group event once", async () => {
    expect(await deliveredCount(inboundProbeAdapter("token"))).toBe(1);
  });

  it("differs from a default adapter, which drops the same event", async () => {
    expect(await deliveredCount(new DiscordAdapter({ token: "token" }))).toBe(0);
  });
});

function unmentionedGroupEvent(): MessageEvent {
  return {
    id: "dc-c1-m1",
    platform: "discord",
    sender: { id: "u1", username: "sender-bot", displayName: "sender-bot" },
    channel: { id: "c1", type: "group" },
    text: "run-marker inbound probe",
    receivedAt: 1,
    discord: {
      guildId: "g1",
      channelId: "c1",
      messageId: "m1",
      raw: { mentions: { users: new Map() } },
    },
  };
}
