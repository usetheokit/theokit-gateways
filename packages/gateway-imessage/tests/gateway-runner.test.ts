import { GatewayRunner } from "@theokit/gateway";
import { expect, it } from "vitest";
import { IMessageAdapter } from "../src/index.js";
import { fakeSpawn, until } from "./fake-child.js";

it("routes an inbound message to a handler and sends its reply through GatewayRunner", async () => {
  const fake = fakeSpawn();
  const adapter = new IMessageAdapter({ spawn: fake.spawn });
  const runner = new GatewayRunner({
    adapters: [adapter],
    handler: async (event, ctx) => {
      await ctx.reply(`you said: ${event.text}`);
    },
  });
  const starting = runner.start();
  await until(() => fake.children[0]?.last("watch.subscribe") !== undefined, "subscribe");
  const child = fake.children[0]!;
  child.answer(child.last("watch.subscribe")!.id, { subscription: 1 });
  await starting;
  try {
    child.message({ id: 1, chat_id: 7, text: "hello" });
    await until(() => child.last("send") !== undefined, "runner reply");
    const request = child.last("send")!;
    expect(request.params).toEqual({ chat_id: 7, text: "you said: hello" });
    child.answer(request.id, { guid: "reply-guid" });
  } finally {
    await runner.stop();
  }
});
