import type { MessageEvent } from "@theokit/gateway";
import { createWebhookHandler } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { GoogleChatAdapter } from "../src/adapter.js";
import { googleChatChannel } from "../src/channel.js";
import {
  APP_PRIVATE_KEY_PEM,
  AUDIENCE,
  idToken,
  messageEvent,
  NOW_MS,
  SERVICE_ACCOUNT,
  scriptedGoogle,
} from "./fixtures.js";

const CONFIG = {
  serviceAccountEmail: SERVICE_ACCOUNT,
  privateKey: APP_PRIVATE_KEY_PEM,
  audience: AUDIENCE,
};
const make = () =>
  new GoogleChatAdapter({
    ...CONFIG,
    webhook: "external",
    fetch: scriptedGoogle().fetch,
    now: () => NOW_MS,
  });
const TEXT = messageEvent();

function signedInit(event: object) {
  return {
    body: JSON.stringify(event),
    headers: { authorization: `Bearer ${idToken()}` },
  };
}
const badInit = (event: object) => ({
  body: JSON.stringify(event),
  headers: { authorization: `Bearer ${idToken(undefined, { signedByStranger: true })}` },
});

function route(adapter: GoogleChatAdapter, started = true) {
  const handler = createWebhookHandler({
    channels: [{ descriptor: googleChatChannel, adapter } as never],
    isStarted: () => started,
  });
  return (init: { body: string; headers: Record<string, string> }) =>
    handler(new Request("https://host.test/webhooks/google_chat", { method: "POST", ...init }));
}

describe("googleChatChannel over createWebhookHandler", () => {
  it("answers 200 and delivers a signed event", async () => {
    const adapter = make();
    const events: MessageEvent[] = [];
    adapter.onInbound(async (e) => {
      events.push(e);
    });
    const res = await route(adapter)(signedInit(TEXT));
    expect(res.status).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(events.map((e) => e.text)).toEqual(["hello there"]);
  });

  it("refuses a wrong signature with 401 and delivers nothing", async () => {
    const adapter = make();
    const events: MessageEvent[] = [];
    adapter.onInbound(async (e) => {
      events.push(e);
    });
    const res = await route(adapter)(badInit(TEXT));
    expect(res.status).toBe(401);
    expect(events).toEqual([]);
  });

  it("answers 503 for a signed message when nothing is subscribed", async () => {
    const res = await route(make())(signedInit(TEXT));
    expect(res.status).toBe(503);
  });

  it("answers 401 for a request without a bearer token", async () => {
    const res = await route(make())({ body: "{}", headers: {} });
    expect(res.status).toBe(401);
  });

  it("answers 401 for a missing bearer without reading the body", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("body was read");
      },
    });
    const request = new Request("https://host.test/webhooks/google_chat", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    const handler = createWebhookHandler({
      channels: [{ descriptor: googleChatChannel, adapter: make() } as never],
      isStarted: () => true,
    });
    expect((await handler(request)).status).toBe(401);
  });

  it("serves verify and ingest through createWebhookHandler when handle is absent", async () => {
    const descriptor = {
      ...googleChatChannel,
      webhook: { ...googleChatChannel.webhook, handle: undefined },
    };
    const adapter = make();
    const events: MessageEvent[] = [];
    adapter.onInbound(async (e) => {
      events.push(e);
    });
    const handler = createWebhookHandler({
      channels: [{ descriptor, adapter } as never],
      isStarted: () => true,
    });
    const url = "https://host.test/webhooks/google_chat";
    const good = await handler(new Request(url, { method: "POST", ...signedInit(TEXT) }));
    expect(good.status).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(events.map((e) => e.text)).toEqual(["hello there"]);
    const bad = await handler(new Request(url, { method: "POST", ...badInit(TEXT) }));
    expect(bad.status).toBe(401);
    expect(events).toHaveLength(1);
  });

  it("refuses a listener webhook config", () => {
    expect(() => googleChatChannel.create({ ...CONFIG, webhook: "listener" })).toThrow(/webhook/);
  });
});
