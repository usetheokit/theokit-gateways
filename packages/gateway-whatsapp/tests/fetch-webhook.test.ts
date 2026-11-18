/** The Cloud descriptor's webhook driven through `createWebhookHandler` with real Fetch requests. */

import { createHmac } from "node:crypto";

import { type ChannelDescriptor, createChannels, createWebhookHandler } from "@theokit/gateway";
import { describe, expect, it, vi } from "vitest";

import { whatsappChannel } from "../src/channel.js";

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "test-verify-token";
const PHONE_ID = "123456";

function setup(subscribe: boolean) {
  const result = createChannels([
    {
      descriptor: whatsappChannel as unknown as ChannelDescriptor,
      config: {
        accessToken: "tok",
        phoneNumberId: PHONE_ID,
        appSecret: APP_SECRET,
        verifyToken: VERIFY_TOKEN,
        requireMention: false,
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

const envelope = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: PHONE_ID },
            contacts: [{ wa_id: "15551230000", profile: { name: "A" } }],
            messages: [
              {
                id: "wamid.1",
                from: "15551230000",
                timestamp: "1700000000",
                type: "text",
                text: { body: "hello" },
              },
            ],
          },
        },
      ],
    },
  ],
});

const sign = (body: string, key = APP_SECRET): string =>
  `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;

const post = (body: string, signature?: string): Request =>
  new Request("https://host.test/webhooks/whatsapp", {
    method: "POST",
    headers: signature === undefined ? {} : { "x-hub-signature-256": signature },
    body,
  });

const get = (query: string): Request =>
  new Request(`https://host.test/webhooks/whatsapp?${query}`, { method: "GET" });

describe("whatsapp Cloud webhook through createWebhookHandler", () => {
  it("answers 200 and delivers the event for a signed POST", async () => {
    const { handler, delivered } = setup(true);
    const res = await handler(post(envelope, sign(envelope)));
    expect(res.status).toBe(200);
    expect(delivered).toHaveLength(1);
    expect(JSON.stringify(delivered[0])).toContain("hello");
  });

  it("answers 200 with no event for a status-only envelope", async () => {
    const { handler, delivered } = setup(true);
    const body = JSON.stringify({
      entry: [{ changes: [{ value: { metadata: { phone_number_id: PHONE_ID }, statuses: [] } }] }],
    });
    expect((await handler(post(body, sign(body)))).status).toBe(200);
    expect(delivered).toEqual([]);
  });

  it("refuses a wrong signature with 401 and delivers nothing", async () => {
    const { handler, delivered } = setup(true);
    expect((await handler(post(envelope, sign(envelope, "other")))).status).toBe(401);
    expect((await handler(post(envelope))).status).toBe(401);
    expect(delivered).toEqual([]);
  });

  it("answers 400 for a signed body that is not JSON", async () => {
    const { handler } = setup(true);
    expect((await handler(post("nope", sign("nope")))).status).toBe(400);
  });

  it("answers the subscription check with the challenge as text/plain", async () => {
    const { handler } = setup(true);
    const res = await handler(
      get(`hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=abc123`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("abc123");
  });

  it("refuses a wrong verify token or mode with 403", async () => {
    const { handler } = setup(true);
    expect(
      (await handler(get("hub.mode=subscribe&hub.verify_token=bad&hub.challenge=x"))).status,
    ).toBe(403);
    expect(
      (await handler(get(`hub.mode=other&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=x`)))
        .status,
    ).toBe(403);
    expect((await handler(get("hub.mode=subscribe&hub.challenge=x"))).status).toBe(403);
  });

  it("answers 503 when no handler is subscribed", async () => {
    const { handler } = setup(false);
    expect((await handler(post(envelope, sign(envelope)))).status).toBe(503);
  });

  it("does not take a PUT", async () => {
    const { handler } = setup(true);
    const res = await handler(
      new Request("https://host.test/webhooks/whatsapp", { method: "PUT" }),
    );
    expect(res.status).toBe(405);
  });

  it("verify answers the same as handle, per method, and fails closed without a method", () => {
    const { adapter, webhook } = setup(true);
    const url = `https://host.test/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=c`;
    const check = (r: object) =>
      webhook?.verify(adapter as never, { rawBody: "", headers: {}, ...r });
    expect(check({ method: "GET", url })).toBe(true);
    expect(check({ method: "GET" })).toBe(false);
    expect(check({ method: "GET", url: url.replace(VERIFY_TOKEN, "bad") })).toBe(false);
    const headers = { "x-hub-signature-256": sign(envelope) };
    expect(check({ method: "POST", rawBody: envelope, headers })).toBe(true);
    expect(check({ rawBody: envelope, headers })).toBe(false);
  });

  it("logs a throwing handler without its message", async () => {
    const { handler, adapter } = setup(false);
    adapter.onInbound(async () => {
      throw new Error("secret body text hello");
    });
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const res = await handler(post(envelope, sign(envelope)));
    const logged = write.mock.calls.map((c) => String(c[0])).join("");
    write.mockRestore();
    expect(res.status).toBe(500);
    expect(logged).not.toContain("secret body text");
  });
});
