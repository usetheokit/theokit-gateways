/** The Twilio descriptor's webhook driven through `createWebhookHandler` with real Fetch requests. */

import { createHmac } from "node:crypto";

import { type ChannelDescriptor, createChannels, createWebhookHandler } from "@theokit/gateway";
import { describe, expect, it, vi } from "vitest";

import { smsChannel } from "../src/channel.js";

const AUTH_TOKEN = "test-auth-token";
const PUBLIC_URL = "https://sms.example.test/webhooks/sms";

function setup(subscribe: boolean) {
  const result = createChannels([
    {
      descriptor: smsChannel as unknown as ChannelDescriptor,
      config: {
        accountSid: "ACtest",
        authToken: AUTH_TOKEN,
        fromNumber: "+14155550123",
        publicUrl: PUBLIC_URL,
      },
    },
  ]);
  const adapter = result.adapters[0] as unknown as {
    onInbound(h: (e: unknown) => Promise<void>): () => void;
  };
  const delivered: unknown[] = [];
  if (subscribe) adapter.onInbound(async (e) => void delivered.push(e));
  const handler = createWebhookHandler({ channels: result.channels, isStarted: () => true });
  return { handler, delivered, adapter, webhook: result.channels[0]?.descriptor.webhook };
}

const fields: Array<[string, string]> = [
  ["Body", "hello"],
  ["From", "+14155550199"],
  ["MessageSid", "SM123"],
  ["To", "+14155550123"],
];
const body = fields.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

function sign(url: string, key = AUTH_TOKEN): string {
  const data = [...fields]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .reduce((s, [k, v]) => s + k + v, url);
  return createHmac("sha1", key).update(data, "utf8").digest("base64");
}

const post = (signature?: string, text = body): Request =>
  // The request URL is the INTERNAL one: only the configured publicUrl may count.
  new Request("http://10.0.0.7:3000/webhooks/sms", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(signature === undefined ? {} : { "x-twilio-signature": signature }),
    },
    body: text,
  });

describe("sms Twilio webhook through createWebhookHandler", () => {
  it("answers 200 and delivers the event for a request signed over the public URL", async () => {
    const { handler, delivered } = setup(true);
    const res = await handler(post(sign(PUBLIC_URL)));
    expect(res.status).toBe(200);
    expect(delivered).toHaveLength(1);
    expect(JSON.stringify(delivered[0])).toContain("hello");
  });

  it("refuses a wrong signature with 401 and delivers nothing", async () => {
    const { handler, delivered } = setup(true);
    expect((await handler(post(sign(PUBLIC_URL, "other")))).status).toBe(401);
    expect((await handler(post())).status).toBe(401);
    expect(delivered).toEqual([]);
  });

  it("refuses a signature made over the request's own URL", async () => {
    const { handler, delivered } = setup(true);
    expect((await handler(post(sign("http://10.0.0.7:3000/webhooks/sms")))).status).toBe(401);
    expect(delivered).toEqual([]);
  });

  it("answers 400 for a signed body that yields no event", async () => {
    const { handler, delivered } = setup(true);
    const sig = createHmac("sha1", AUTH_TOKEN).update(PUBLIC_URL, "utf8").digest("base64");
    expect((await handler(post(sig, ""))).status).toBe(400);
    expect(delivered).toEqual([]);
  });

  it("answers 503 when no handler is subscribed", async () => {
    const { handler } = setup(false);
    expect((await handler(post(sign(PUBLIC_URL)))).status).toBe(503);
  });

  it("does not take a GET", async () => {
    const { handler } = setup(true);
    expect((await handler(new Request("https://h.test/webhooks/sms"))).status).toBe(405);
  });

  it("verify agrees with handle before the adapter has connected", () => {
    const { adapter, webhook } = setup(true);
    const req = (signature: string) => ({
      rawBody: body,
      headers: { "X-Twilio-Signature": signature },
    });
    expect(webhook?.verify(adapter as never, req(sign(PUBLIC_URL)))).toBe(true);
    expect(webhook?.verify(adapter as never, req(sign(PUBLIC_URL, "other")))).toBe(false);
  });

  it("logs a throwing handler without its message", async () => {
    const { handler, adapter } = setup(false);
    adapter.onInbound(async () => {
      throw new Error("secret body text hello");
    });
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const res = await handler(post(sign(PUBLIC_URL)));
    const logged = write.mock.calls.map((c) => String(c[0])).join("");
    write.mockRestore();
    expect(res.status).toBe(500);
    expect(logged).not.toContain("secret body text");
  });
});
