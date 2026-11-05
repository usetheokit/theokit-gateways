import { GatewayRunner } from "@theokit/gateway";
import { expect, it, vi } from "vitest";
import { NextcloudTalkAdapter } from "../src/index.js";
import {
  BASE_URL,
  CREATE_BODY,
  freePort,
  ROOM,
  SECRET,
  scriptedTalk,
  signedHeaders,
  talkSignature,
} from "./fixtures.js";

it("replies to a signed Talk webhook through GatewayRunner", async () => {
  const talk = scriptedTalk();
  const adapter = new NextcloudTalkAdapter({
    baseUrl: BASE_URL,
    secret: SECRET,
    fetch: talk.fetch,
    port: await freePort(),
  });
  const runner = new GatewayRunner({
    adapters: [adapter],
    handler: async (event, ctx) => {
      await ctx.reply(`you said: ${event.text}`);
    },
  });
  try {
    await runner.start();
    const raw = JSON.stringify(CREATE_BODY);
    expect((await adapter.handleRequest(signedHeaders(raw), raw)).status).toBe(200);
    await vi.waitFor(() => expect(talk.sends).toHaveLength(1));
    const send = talk.sends[0]!;
    expect(send.url).toContain(`/bot/${ROOM}/message`);
    expect(send.body.message).toBe(`you said: hello **bold** from B-358`);
    expect(send.headers.get("x-nextcloud-talk-bot-signature")).toBe(
      talkSignature(send.headers.get("x-nextcloud-talk-bot-random")!, send.body.message),
    );
  } finally {
    await runner.stop();
  }
});
