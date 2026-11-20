/** The Teams descriptor's webhook driven through `createWebhookHandler` with real Fetch requests. */

import { type ChannelDescriptor, createChannels, createWebhookHandler } from "@theokit/gateway";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { teamsChannel } from "../src/channel.js";
import { rememberTeamsWebhook } from "../src/fetch-webhook.js";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, SERVICE_URL, startKeyServer } from "./helpers/key-server.js";
import { verifierUnderTest } from "./helpers/verifier-under-test.js";
import "@microsoft/teams.apps/dist/middleware/index.js";

const activity = {
  type: "message",
  id: "activity-1",
  text: "hello",
  serviceUrl: SERVICE_URL,
  channelId: "msteams",
  from: { id: "user-1", name: "User" },
  conversation: { id: "conversation-1", conversationType: "personal" },
  recipient: { id: "bot-1" },
};

describe("teams webhook through createWebhookHandler", () => {
  let ks: KeyServer;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    ks = await startKeyServer();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await ks.close();
  });

  function setup(subscribe: boolean, verifier?: (r: Request) => Promise<never>) {
    const result = createChannels([
      {
        descriptor: teamsChannel as unknown as ChannelDescriptor,
        config: { clientId: CLIENT_ID, clientSecret: "s", tenantId: "tenant-1" },
      },
    ]);
    const adapter = result.adapters[0] as unknown as {
      onInbound(h: (e: unknown) => Promise<void>): () => void;
    };
    // The test verifier reads keys from the local key server instead of Microsoft's.
    rememberTeamsWebhook(
      adapter,
      { clientId: CLIENT_ID },
      verifier ?? verifierUnderTest({ clientId: CLIENT_ID, cloud: ks.cloud }),
    );
    const delivered: Array<{ text?: string }> = [];
    if (subscribe) adapter.onInbound(async (e) => void delivered.push(e as { text?: string }));
    const handler = createWebhookHandler({ channels: result.channels, isStarted: () => true });
    return { handler, delivered };
  }

  const toHandler = (request: Request) =>
    new Request("https://bot.test/webhooks/teams", {
      method: "POST",
      headers: request.headers,
      body: request.body,
      duplex: "half",
    });

  it("delivers a signed activity and answers 200", async () => {
    const { handler, delivered } = setup(true);
    const res = await handler(toHandler(activityRequest(ks.signToken({}), activity)));
    expect(res.status).toBe(200);
    expect(delivered.map((e) => e.text)).toEqual(["hello"]);
  });

  it("refuses a forged token with 401 and delivers nothing", async () => {
    const { handler, delivered } = setup(true);
    const forged = ks.otherKeySign({});
    const res = await handler(toHandler(activityRequest(forged, activity)));
    expect(res.status).toBe(401);
    expect(delivered).toEqual([]);
    expect(warn.mock.calls.flat().join(" ")).not.toContain(forged);
  });

  it("answers 400 for a body that is not an activity, without logging", async () => {
    const { handler } = setup(true);
    const res = await handler(toHandler(activityRequest(ks.signToken({}), "not json")));
    expect(res.status).toBe(400);
    expect(warn).not.toHaveBeenCalled();
  });

  it("answers 503 for a key set it cannot read", async () => {
    const { handler } = setup(true);
    ks.failNext(503);
    const res = await handler(toHandler(activityRequest(ks.signToken({}), activity)));
    expect(res.status).toBe(503);
  });

  it("answers 401, not 500, when the verifier throws", async () => {
    const { handler, delivered } = setup(true, async () => {
      throw new Error("boom");
    });
    const res = await handler(toHandler(activityRequest(ks.signToken({}), activity)));
    expect(res.status).toBe(401);
    expect(delivered).toEqual([]);
  });

  it("answers 503 when no handler is subscribed", async () => {
    const { handler } = setup(false);
    const res = await handler(toHandler(activityRequest(ks.signToken({}), activity)));
    expect(res.status).toBe(503);
  });

  it("does not log an unknown conversation type", async () => {
    const { handler } = setup(true);
    const odd = { ...activity, conversation: { id: "c", conversationType: "SECRET-TEXT" } };
    await handler(toHandler(activityRequest(ks.signToken({}), odd)));
    expect(warn.mock.calls.flat().join(" ")).not.toContain("SECRET-TEXT");
  });
});
