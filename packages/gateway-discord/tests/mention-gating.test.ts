import type { DiscordMessageEvent, MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiscordAdapter, type DiscordAdapterOptions } from "../src/adapter.js";

const BOT_ID = "999";

interface RawMentions {
  users?: Map<string, unknown>;
  roles?: Map<string, unknown>;
  everyone?: boolean;
}

function makeAdapter(extra: Partial<DiscordAdapterOptions> = {}): DiscordAdapter {
  const adapter = new DiscordAdapter({ token: "t", ...extra });
  // The bot id is `client.user.id`, which discord.js fills on `ready`; a test stands it in.
  (adapter.getBot() as unknown as { user: { id: string } }).user = { id: BOT_ID };
  return adapter;
}

function discordEvent(opts: {
  channelType: "dm" | "group" | "thread";
  text?: string;
  mentions?: RawMentions;
}): DiscordMessageEvent {
  const raw = opts.mentions === undefined ? {} : { mentions: opts.mentions };
  return {
    id: "dc-c1-m1",
    platform: "discord",
    sender: { id: "u1", username: "alice", displayName: "alice" },
    channel: { id: "c1", type: opts.channelType },
    text: opts.text ?? "hello",
    receivedAt: 1,
    discord: {
      guildId: opts.channelType === "dm" ? null : "g1",
      channelId: "c1",
      messageId: "m1",
      raw,
    },
  };
}

function recordDeliveries(adapter: DiscordAdapter): MessageEvent[] {
  const delivered: MessageEvent[] = [];
  adapter.onInbound(async (event) => {
    delivered.push(event);
  });
  return delivered;
}

const botMentioned = (): RawMentions => ({ users: new Map([[BOT_ID, {}]]) });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DiscordAdapter.deliver mention gating", () => {
  it("does not deliver an unmentioned group event under the default, and answers ok", async () => {
    const adapter = makeAdapter();
    const delivered = recordDeliveries(adapter);

    const outcome = await adapter.deliver(
      discordEvent({ channelType: "group", mentions: { users: new Map() } }),
    );

    expect(outcome).toBe("ok");
    expect(delivered).toHaveLength(0);
  });

  it("delivers an unmentioned group event once with requireMention false", async () => {
    const adapter = makeAdapter({ requireMention: false });
    const delivered = recordDeliveries(adapter);

    await adapter.deliver(discordEvent({ channelType: "group", mentions: { users: new Map() } }));

    expect(delivered).toHaveLength(1);
  });

  it.each([true, false])(
    "delivers a group event whose raw mentions.users holds the bot once (requireMention %s)",
    async (requireMention) => {
      const adapter = makeAdapter({ requireMention });
      const delivered = recordDeliveries(adapter);

      await adapter.deliver(discordEvent({ channelType: "group", mentions: botMentioned() }));

      expect(delivered).toHaveLength(1);
    },
  );

  it.each([true, false])("delivers a DM once (requireMention %s)", async (requireMention) => {
    const adapter = makeAdapter({ requireMention });
    const delivered = recordDeliveries(adapter);

    await adapter.deliver(discordEvent({ channelType: "dm", mentions: { users: new Map() } }));

    expect(delivered).toHaveLength(1);
  });

  it("does not deliver a thread event with no mention", async () => {
    const adapter = makeAdapter();
    const delivered = recordDeliveries(adapter);

    await adapter.deliver(discordEvent({ channelType: "thread", mentions: { users: new Map() } }));

    expect(delivered).toHaveLength(0);
  });

  it("does not deliver @everyone when the bot is absent from mentions.users", async () => {
    const adapter = makeAdapter();
    const delivered = recordDeliveries(adapter);

    await adapter.deliver(
      discordEvent({ channelType: "group", text: "@everyone hi", mentions: { users: new Map() } }),
    );

    expect(delivered).toHaveLength(0);
  });

  it("delivers a reply ping (bot in raw mentions.users, no <@ID> in text) with requireMention true", async () => {
    const adapter = makeAdapter({ requireMention: true });
    const delivered = recordDeliveries(adapter);

    await adapter.deliver(
      discordEvent({ channelType: "group", text: "replying", mentions: botMentioned() }),
    );

    expect(delivered).toHaveLength(1);
  });

  it("does not deliver <@ID> in text when raw mentions.users lacks the bot", async () => {
    const adapter = makeAdapter();
    const delivered = recordDeliveries(adapter);

    await adapter.deliver(
      discordEvent({
        channelType: "group",
        text: `<@${BOT_ID}> hi`,
        mentions: { users: new Map() },
      }),
    );

    expect(delivered).toHaveLength(0);
  });

  it.each([`<@${BOT_ID}> hi`, `<@!${BOT_ID}> hi`])(
    "delivers %s when the raw message carries no mentions collection (text fallback)",
    async (text) => {
      const adapter = makeAdapter();
      const delivered = recordDeliveries(adapter);

      await adapter.deliver(discordEvent({ channelType: "group", text }));

      expect(delivered).toHaveLength(1);
    },
  );

  it("does not deliver plain text when the raw message carries no mentions collection", async () => {
    const adapter = makeAdapter();
    const delivered = recordDeliveries(adapter);

    await adapter.deliver(discordEvent({ channelType: "group", text: "hello" }));

    expect(delivered).toHaveLength(0);
  });

  it("does not deliver mentions.everyone true with the bot absent from mentions.users", async () => {
    const adapter = makeAdapter();
    const delivered = recordDeliveries(adapter);

    await adapter.deliver(
      discordEvent({ channelType: "group", mentions: { everyone: true, users: new Map() } }),
    );

    expect(delivered).toHaveLength(0);
  });

  it("does not deliver a role mention the bot holds when the bot is absent from mentions.users", async () => {
    const adapter = makeAdapter();
    const delivered = recordDeliveries(adapter);

    await adapter.deliver(
      discordEvent({
        channelType: "group",
        mentions: { roles: new Map([["role-the-bot-holds", {}]]), users: new Map() },
      }),
    );

    expect(delivered).toHaveLength(0);
  });

  it("answers ok for a dropped event with no handler subscribed", async () => {
    const adapter = makeAdapter();

    const outcome = await adapter.deliver(
      discordEvent({ channelType: "group", mentions: { users: new Map() } }),
    );

    expect(outcome).toBe("ok");
  });
});
