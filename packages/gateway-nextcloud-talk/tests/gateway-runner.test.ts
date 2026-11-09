import { GatewayRunner } from "@theokit/gateway";
import express from "express";
import { expect, it } from "vitest";
import { NextcloudTalkAdapter } from "../src/index.js";
import {
  BASE_URL,
  BOT_MESSAGE_URL,
  CREATE_BODY,
  ROOM,
  SECRET,
  scriptedTalk,
  signedHeaders,
  talkSignature,
} from "./fixtures.js";

it("routes a signed inbound message through GatewayRunner and signs its reply", async () => {
  const talk = scriptedTalk();
  const adapter = new NextcloudTalkAdapter({
    baseUrl: BASE_URL,
    secret: SECRET,
    fetch: talk.fetch,
    app: express(),
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
    await new Promise((resolve) => setImmediate(resolve));
    expect(talk.sends).toHaveLength(1);
    const send = talk.sends[0]!;
    expect(send.url).toBe(BOT_MESSAGE_URL);
    expect(send.url).toContain(ROOM);
    expect(send.body.message).toBe("you said: hello **bold** from B-358");
    expect(send.headers.get("x-nextcloud-talk-bot-signature")).toBe(
      talkSignature(send.headers.get("x-nextcloud-talk-bot-random")!, send.body.message),
    );
  } finally {
    await runner.stop();
  }
});
