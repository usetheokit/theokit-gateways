/** DiscordAdapter.capabilities — the splitter's limit, and thread events with a topicId. */

import { Events } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { DiscordAdapter } from "../src/adapter.js";
import { DISCORD_MAX_MESSAGE } from "../src/split.js";

describe("DiscordAdapter.capabilities", () => {
  it("reports the splitter limit and threads", () => {
    const c = new DiscordAdapter({ token: "t" }).capabilities;
    expect(c.maxMessageChars).toBe(DISCORD_MAX_MESSAGE);
    expect(c.threads).toBe(true);
  });

  it("normalizes a thread message to channel.type thread with a topicId", async () => {
    const adapter = new DiscordAdapter({ token: "t", requireMention: false });
    const seen: { channel: { type: string; topicId?: string } }[] = [];
    adapter.onInbound(async (event) => {
      seen.push(event);
    });
    adapter.getBot().emit(Events.MessageCreate, {
      id: "m1",
      channelId: "th1",
      guildId: "g1",
      content: "hi",
      createdTimestamp: 1,
      reference: null,
      author: { id: "u1", bot: false, username: "alice", globalName: null },
      channel: { id: "th1", isThread: () => true },
      mentions: { users: new Map() },
    } as never);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]?.channel).toMatchObject({ type: "thread", topicId: "th1" });
  });
});
