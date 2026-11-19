/** The Nextcloud Talk descriptor's webhook driven through `createWebhookHandler` with real Requests. */

import { type ChannelDescriptor, createChannels, createWebhookHandler } from "@theokit/gateway";
import { describe, expect, it, vi } from "vitest";

import { nextcloudTalkChannel } from "../src/channel.js";
import { BASE_URL, CREATE_BODY, freshRandom, SECRET, talkSignature } from "./fixtures.js";

function setup(subscribe: boolean) {
  const result = createChannels([
    {
      descriptor: nextcloudTalkChannel as unknown as ChannelDescriptor,
      config: { baseUrl: BASE_URL, secret: SECRET },
    },
  ]);
  const adapter = result.adapters[0] as unknown as {
    onInbound(h: (e: unknown) => Promise<void>): () => void;
  };
  const delivered: unknown[] = [];
  if (subscribe) adapter.onInbound(async (e) => void delivered.push(e));
  const handler = createWebhookHandler({ channels: result.channels, isStarted: () => true });
  return { handler, delivered, webhook: result.channels[0]?.descriptor.webhook };
}

const raw = JSON.stringify(CREATE_BODY);

function post(secret = SECRET, text = raw, withHeaders = true): Request {
  const random = freshRandom();
  return new Request("http://localhost/webhooks/nextcloud_talk", {
    method: "POST",
    headers: withHeaders
      ? {
          "content-type": "application/json",
          "x-nextcloud-talk-random": random,
          "x-nextcloud-talk-signature": talkSignature(random, text, secret),
        }
      : { "content-type": "application/json" },
    body: text,
  });
}

async function until(check: () => boolean): Promise<void> {
  await vi.waitFor(() => expect(check()).toBe(true));
}

describe("nextcloud talk webhook through createWebhookHandler", () => {
  it("declares the webhook transport and POST", () => {
    expect(nextcloudTalkChannel.transport).toBe("webhook");
    expect(nextcloudTalkChannel.webhook.methods).toEqual(["POST"]);
  });

  it("answers 200 and delivers the event for a signed request", async () => {
    const { handler, delivered } = setup(true);
    const res = await handler(post());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    await until(() => delivered.length === 1);
    expect(JSON.stringify(delivered[0])).toContain("hello");
  });

  it("refuses a wrong or missing signature with 401 and delivers nothing", async () => {
    const { handler, delivered } = setup(true);
    expect((await handler(post("x".repeat(50)))).status).toBe(401);
    expect((await handler(post(SECRET, raw, false))).status).toBe(401);
    expect(delivered).toEqual([]);
  });

  it("answers 503 when no handler is subscribed", async () => {
    const { handler } = setup(false);
    expect((await handler(post())).status).toBe(503);
  });

  it("verify and ingest follow the same credentials", async () => {
    const { webhook, delivered } = setup(true);
    const adapter = createChannels([
      {
        descriptor: nextcloudTalkChannel as unknown as ChannelDescriptor,
        config: { baseUrl: BASE_URL, secret: SECRET },
      },
    ]).adapters[0];
    const random = freshRandom();
    const request = {
      rawBody: raw,
      headers: {
        "X-Nextcloud-Talk-Random": random,
        "X-Nextcloud-Talk-Signature": talkSignature(random, raw),
      },
    };
    expect(webhook?.verify(adapter as never, request)).toBe(true);
    expect(webhook?.verify(adapter as never, { ...request, rawBody: "{}" })).toBe(false);
    expect(await webhook?.ingest(adapter as never, null)).toBe("malformed");
    expect(await webhook?.ingest(adapter as never, CREATE_BODY)).toBe("no_handler");
    expect(delivered).toEqual([]);
  });
});
