/** The Synology Chat descriptor's webhook driven through `createWebhookHandler` with real Requests. */

import { type ChannelDescriptor, createChannels, createWebhookHandler } from "@theokit/gateway";
import express from "express";
import { describe, expect, it, vi } from "vitest";

import { synologyChatChannel } from "../src/channel.js";
import { BOT_TOKEN, callbackForm, INCOMING_URL, ScriptedNas } from "./fixtures.js";

async function setup(subscribe: boolean) {
  const result = createChannels([
    {
      descriptor: synologyChatChannel as unknown as ChannelDescriptor,
      config: {
        botToken: BOT_TOKEN,
        incomingUrl: INCOMING_URL,
        app: express(),
        fetch: new ScriptedNas().fetch,
      },
    },
  ]);
  const adapter = result.adapters[0] as unknown as {
    onInbound(h: (e: unknown) => Promise<void>): () => void;
    connect(): Promise<boolean>;
    disconnect(): Promise<void>;
  };
  const delivered: unknown[] = [];
  if (subscribe) adapter.onInbound(async (e) => void delivered.push(e));
  expect(await adapter.connect()).toBe(true);
  const handler = createWebhookHandler({ channels: result.channels, isStarted: () => true });
  return { handler, delivered, adapter, webhook: result.channels[0]?.descriptor.webhook };
}

const post = (body: string): Request =>
  new Request("http://localhost/webhooks/synology_chat", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

describe("synology chat webhook through createWebhookHandler", () => {
  it("declares the webhook transport and POST", () => {
    expect(synologyChatChannel.transport).toBe("webhook");
    expect(synologyChatChannel.webhook.methods).toEqual(["POST"]);
  });

  it("answers 200 and delivers the event for a callback with the token", async () => {
    const { handler, delivered, adapter } = await setup(true);
    const res = await handler(post(callbackForm({})));
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(delivered).toHaveLength(1));
    expect(JSON.stringify(delivered[0])).toContain("hello bot");
    await adapter.disconnect();
  });

  it("refuses a wrong token with 401 and a missing one with 400, delivering nothing", async () => {
    const { handler, delivered, adapter } = await setup(true);
    expect((await handler(post(callbackForm({ token: "wrong-token-value" })))).status).toBe(401);
    expect((await handler(post(callbackForm({ token: "" })))).status).toBe(400);
    expect(delivered).toEqual([]);
    await adapter.disconnect();
  });

  it("answers 503 when no handler is subscribed", async () => {
    const { handler, adapter } = await setup(false);
    expect((await handler(post(callbackForm({})))).status).toBe(503);
    await adapter.disconnect();
  });

  it("verify and ingest follow the same token", async () => {
    const { webhook, adapter, delivered } = await setup(true);
    const headers = { "content-type": "application/x-www-form-urlencoded" };
    expect(webhook?.verify(adapter as never, { rawBody: callbackForm({}), headers })).toBe(true);
    expect(
      webhook?.verify(adapter as never, { rawBody: callbackForm({ token: "nope" }), headers }),
    ).toBe(false);
    expect(await webhook?.ingest(adapter as never, "x")).toBe("malformed");
    expect(
      await webhook?.ingest(adapter as never, { user_id: "42", text: "via ingest", post_id: "9" }),
    ).toBe("delivered");
    await vi.waitFor(() => expect(delivered).toHaveLength(1));
    await adapter.disconnect();
  });
});
