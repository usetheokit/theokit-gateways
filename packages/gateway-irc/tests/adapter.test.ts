import { GatewayRunner } from "@theokit/gateway";
import { expect, it } from "vitest";
import { FakeIrcServer } from "./fake-server.js";

it("receives a real protocol message and replies through GatewayRunner", async () => {
  const server = await FakeIrcServer.start();
  const adapter = server.adapter();
  const runner = new GatewayRunner({
    adapters: [adapter],
    handler: async (event, ctx) => {
      await ctx.reply(`heard: ${event.text}`);
    },
  });
  try {
    await runner.start();
    server.push(":alice!user@host PRIVMSG theobot :hello");
    await expect.poll(() => server.linesOf("PRIVMSG")).toEqual(["PRIVMSG alice :heard: hello"]);
  } finally {
    await runner.stop();
    await server.close();
  }
});

it("deliver reports missing and throwing handlers without rejecting", async () => {
  const server = await FakeIrcServer.start();
  const adapter = server.adapter();
  try {
    // Obtain a normalized event through the public receive path.
    const events: Parameters<Parameters<typeof adapter.onInbound>[0]>[0][] = [];
    const unsubscribe = adapter.onInbound(async (event) => {
      events.push(event);
    });
    expect(await adapter.connect()).toBe(true);
    server.push(":alice!user@host PRIVMSG #theokit :hello");
    await expect.poll(() => events.length).toBe(1);
    unsubscribe();
    expect(await adapter.deliver(events[0]!)).toBe("no_handler");
    adapter.onInbound(async () => {
      throw new Error("handler failure");
    });
    expect(await adapter.deliver(events[0]!)).toBe("handler_threw");
  } finally {
    await adapter.disconnect();
    await server.close();
  }
});
