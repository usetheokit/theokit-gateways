import { GatewayRunner, type MessageEvent } from "@theokit/gateway";
import { expect, it } from "vitest";
import { FakeIrcServer, until } from "./fake-server.js";

it("routes channel and direct messages through GatewayRunner and replies to their source", async () => {
  const server = await FakeIrcServer.start();
  const adapter = server.adapter();
  const events: MessageEvent[] = [];
  const runner = new GatewayRunner({
    adapters: [adapter],
    handler: async (event, ctx) => {
      events.push(event);
      await ctx.reply(`you said: ${event.text}`);
    },
  });
  try {
    await runner.start();
    server.push("@msgid=channel-1 :alice!u@host PRIVMSG #theokit :hello channel");
    server.push("@msgid=dm-1 :alice!u@host PRIVMSG theobot :hello privately");
    await until(() => server.linesOf("PRIVMSG").length === 2, "runner replies");
    expect(server.linesOf("PRIVMSG")).toEqual([
      "PRIVMSG #theokit :you said: hello channel",
      "PRIVMSG alice :you said: hello privately",
    ]);
    expect(events.map(({ id, channel }) => ({ id, channel }))).toEqual([
      { id: "channel-1", channel: { id: "#theokit", type: "group" } },
      { id: "dm-1", channel: { id: "alice", type: "dm" } },
    ]);
    expect(await adapter.deliver(events[0]!)).toBe("ok");
    await until(() => server.linesOf("PRIVMSG").length === 3, "deliver reply");
  } finally {
    await runner.stop();
    await server.close();
  }
  expect(await adapter.deliver(events[0]!)).toBe("no_handler");
});

it("contains errors from an out-of-band inbound handler", async () => {
  const server = await FakeIrcServer.start();
  const adapter = server.adapter();
  const event = {
    platform: "irc",
    id: "test",
    text: "hello",
    sender: { id: "alice" },
    channel: { id: "alice", type: "dm" },
    receivedAt: 0,
  } as MessageEvent;
  try {
    const unsubscribe = adapter.onInbound(async () => {
      throw new Error("handler failure");
    });
    expect(await adapter.deliver(event)).toBe("handler_threw");
    unsubscribe();
    expect(await adapter.deliver(event)).toBe("no_handler");
  } finally {
    await server.close();
  }
});
