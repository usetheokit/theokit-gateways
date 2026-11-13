import { describe, expect, it, vi } from "vitest";

import type {
  ChannelDescriptor,
  ChannelWebhook,
  IngestResult,
  WebhookRequest,
} from "../src/channel/channel-descriptor.js";
import type { BuiltChannel } from "../src/channel/create-channels.js";
import { createWebhookHandler } from "../src/webhook/fetch-handler.js";
import { MockAdapter } from "./adapter/mock-adapter.js";

function channel(
  platform: string,
  webhook: Partial<ChannelWebhook<MockAdapter>> = {},
): BuiltChannel {
  const full: ChannelWebhook<MockAdapter> = {
    verify: () => true,
    ingest: async () => "delivered" as IngestResult,
    ...webhook,
  };
  const descriptor: ChannelDescriptor<MockAdapter> = {
    platform: platform as never,
    transport: "webhook",
    config: [],
    create: () => new MockAdapter(platform as never),
    webhook: full,
  };
  return {
    descriptor: descriptor as ChannelDescriptor<never>,
    adapter: new MockAdapter(platform as never),
  };
}

function make(webhook?: Partial<ChannelWebhook<MockAdapter>>, extra = {}) {
  return createWebhookHandler({
    channels: [channel("fake", webhook)],
    isStarted: () => true,
    maxBodyBytes: 10,
    ...extra,
  });
}

const post = (body: string, path = "/webhooks/fake") =>
  new Request(`http://x${path}`, { method: "POST", body });

describe("createWebhookHandler", () => {
  it("404s an unknown platform and a socket channel", async () => {
    const socket: BuiltChannel = {
      descriptor: {
        platform: "sock" as never,
        transport: "socket",
        config: [],
        create: () => new MockAdapter("sock" as never),
      } as unknown as ChannelDescriptor<never>,
      adapter: new MockAdapter("sock" as never),
    };
    const h = createWebhookHandler({ channels: [socket], isStarted: () => true });
    expect((await h(post("{}", "/webhooks/nope"))).status).toBe(404);
    expect((await h(post("{}", "/webhooks/sock"))).status).toBe(404);
  });
  it("503s while not started", async () => {
    const h = createWebhookHandler({ channels: [channel("fake")], isStarted: () => false });
    expect((await h(post("{}"))).status).toBe(503);
  });
  it("405s a GET on a POST-only channel", async () => {
    const res = await make()(new Request("http://x/webhooks/fake"));
    expect(res.status).toBe(405);
  });
  it("413s a body over the cap with connection: close", async () => {
    const res = await make()(post("a".repeat(11)));
    expect(res.status).toBe(413);
    expect(res.headers.get("connection")).toBe("close");
  });
  it("accepts a body of exactly the cap", async () => {
    expect((await make()(post('{"a":"bcd"}'.slice(0, 10)))).status).toBe(400);
  });
  it("401s when verify is false", async () => {
    expect((await make({ verify: () => false })(post("{}"))).status).toBe(401);
  });
  it("400s a non-JSON body and a malformed ingest", async () => {
    expect((await make()(post("nope"))).status).toBe(400);
    expect((await make({ ingest: async () => "malformed" })(post("{}"))).status).toBe(400);
  });
  it("503s no_handler and 200s delivered", async () => {
    expect((await make({ ingest: async () => "no_handler" })(post("{}"))).status).toBe(503);
    expect((await make()(post("{}"))).status).toBe(200);
  });
  it("lets handle answer with its body, and passes method and url", async () => {
    let seen: WebhookRequest | undefined;
    const h = make({
      methods: ["GET"],
      handle: async (_a, r) => {
        seen = r;
        return { status: 200, body: "echo", contentType: "text/plain" };
      },
    });
    const res = await h(new Request("http://x/webhooks/fake?a=1"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("echo");
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(seen?.method).toBe("GET");
    expect(seen?.url).toBe("http://x/webhooks/fake?a=1");
  });
  it("500s with no body when handle throws and calls onError once", async () => {
    const onError = vi.fn();
    const h = make(
      {
        handle: async () => {
          throw new Error("secret");
        },
      },
      { onError },
    );
    const res = await h(post("{}"));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe("fake");
  });
});
