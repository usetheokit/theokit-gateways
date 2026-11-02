import type { MessageEvent } from "@theokit/gateway";
import { Events } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiscordAdapter } from "../src/adapter.js";

const BOT_ID = "999";

// The shape `handleInbound` and `normalizeEvent` read off a discord.js `Message`. A real one cannot
// be built without a live client, so the test emits this on the client's own `MessageCreate`.
function guildMessage(
  id: string,
  mentionedUserIds: string[],
  opts: { authorIsBot?: boolean; dm?: boolean } = {},
): unknown {
  return {
    id,
    channelId: "c1",
    guildId: opts.dm === true ? null : "g1",
    content: "hello",
    createdTimestamp: 1,
    reference: null,
    author: { id: "u1", bot: opts.authorIsBot === true, username: "alice", globalName: null },
    channel: { id: "c1", isThread: () => false },
    mentions: { users: new Map(mentionedUserIds.map((userId) => [userId, {}])) },
  };
}

function recordDeliveries(adapter: DiscordAdapter): MessageEvent[] {
  const delivered: MessageEvent[] = [];
  adapter.onInbound(async (event) => {
    delivered.push(event);
  });
  return delivered;
}

function setBotId(adapter: DiscordAdapter): void {
  (adapter.getBot() as unknown as { user: { id: string } }).user = { id: BOT_ID };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DiscordAdapter native MessageCreate mention gating", () => {
  it("never hands an unmentioned group message to the handler, and hands a mentioned one", async () => {
    const adapter = new DiscordAdapter({ token: "t" });
    setBotId(adapter);
    const delivered = recordDeliveries(adapter);

    adapter.getBot().emit(Events.MessageCreate, guildMessage("unmentioned", []) as never);
    adapter.getBot().emit(Events.MessageCreate, guildMessage("mentioned", [BOT_ID]) as never);

    await vi.waitFor(() => {
      expect(delivered.map((e) => e.id)).toContain("dc-c1-mentioned");
    });
    expect(delivered.map((e) => e.id)).toEqual(["dc-c1-mentioned"]);
  });

  it("drops 3 group messages before ready and writes exactly 1 stderr line", async () => {
    const adapter = new DiscordAdapter({ token: "t" });
    const delivered = recordDeliveries(adapter);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    for (const id of ["a", "b"]) {
      adapter.getBot().emit(Events.MessageCreate, guildMessage(id, [BOT_ID]) as never);
    }
    // The third goes through deliver(), which can be awaited, so every drop has settled after it.
    const outcome = await adapter.deliver(eventFrom("c"));

    expect(outcome).toBe("ok");
    expect(delivered).toHaveLength(0);
    const lines = stderr.mock.calls.map((call) => String(call[0]));
    expect(lines).toEqual([
      "[discord] dropping every group message: requireMention is on and the bot user id is not known until the client is ready\n",
    ]);
  });

  it("delivers a DM before ready and writes no stderr line", async () => {
    const adapter = new DiscordAdapter({ token: "t" });
    const delivered = recordDeliveries(adapter);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    adapter.getBot().emit(Events.MessageCreate, guildMessage("dm", [], { dm: true }) as never);

    await vi.waitFor(() => {
      expect(delivered).toHaveLength(1);
    });
    expect(stderr).not.toHaveBeenCalled();
  });

  it("delivers a group message before ready with requireMention false and writes no stderr line", async () => {
    const adapter = new DiscordAdapter({ token: "t", requireMention: false });
    const delivered = recordDeliveries(adapter);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    adapter.getBot().emit(Events.MessageCreate, guildMessage("g", []) as never);

    await vi.waitFor(() => {
      expect(delivered).toHaveLength(1);
    });
    expect(stderr).not.toHaveBeenCalled();
  });

  it("still drops a bot-authored message that mentions the bot", async () => {
    const adapter = new DiscordAdapter({ token: "t" });
    setBotId(adapter);
    const delivered = recordDeliveries(adapter);

    adapter
      .getBot()
      .emit(
        Events.MessageCreate,
        guildMessage("from-bot", [BOT_ID], { authorIsBot: true }) as never,
      );
    adapter.getBot().emit(Events.MessageCreate, guildMessage("from-user", [BOT_ID]) as never);

    await vi.waitFor(() => {
      expect(delivered.map((e) => e.id)).toContain("dc-c1-from-user");
    });
    expect(delivered.map((e) => e.id)).toEqual(["dc-c1-from-user"]);
  });

  it("makes no platform request across every gated event (NFR-001)", async () => {
    const adapter = new DiscordAdapter({ token: "t" });
    setBotId(adapter);
    recordDeliveries(adapter);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("the gate must not reach the network"));
    const restSpy = vi.spyOn(adapter.getBot().rest, "request");
    const channelFetch = vi.spyOn(adapter.getBot().channels, "fetch");

    for (const id of ["a", "b", "c"]) {
      adapter.getBot().emit(Events.MessageCreate, guildMessage(id, []) as never);
      await adapter.deliver(eventFrom(id));
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(restSpy).not.toHaveBeenCalled();
    expect(channelFetch).not.toHaveBeenCalled();
  });
});

function eventFrom(id: string): MessageEvent {
  return {
    id: `dc-c1-${id}`,
    platform: "discord",
    sender: { id: "u1", username: "alice", displayName: "alice" },
    channel: { id: "c1", type: "group" },
    text: "hello",
    receivedAt: 1,
    discord: {
      guildId: "g1",
      channelId: "c1",
      messageId: id,
      raw: { mentions: { users: new Map() } },
    },
  };
}
