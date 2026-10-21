/**
 * The edit's conversation-client shape, checked against the SDK the suite installs.
 *
 * `edit-message.test.ts` fakes `app.api.conversations` by hand, and `createDefaultTeamsApp` types
 * the dynamic import's `App` through a cast, so `tsc` never compares `TeamsAppLike.api` with the
 * real SDK. Here the conversation client comes from a real `App`, built from both installed SDK
 * lines and never started (construction makes no request). A release that renamed or moved
 * `activities(id).update`, or `updateActivity` where the SDK has it, fails this file instead of
 * production.
 *
 * `updateActivity` exists from `@microsoft/teams.api` 2.0.14 and the peer range starts at 2.0.0,
 * so the suite run at the floor may install an SDK without it. The request is intercepted at
 * whichever call the adapter picks, on the SDK's own objects, so the file holds on either side.
 */

import * as sdkInstalled from "@microsoft/teams.apps";
import * as sdk21 from "@microsoft/teams.apps-2-1";
import type { OutboundMessage } from "@theokit/gateway";
import { describe, expect, it, vi } from "vitest";

import { TeamsAdapter } from "../src/adapter.js";

type Update = (...args: unknown[]) => Promise<unknown>;

interface RealConversations {
  activities(conversationId: string): { update: Update };
  updateActivity?: Update;
}

const SDKS = [
  ["the installed line", sdkInstalled.App],
  ["2.1", sdk21.App],
] as const;

const CONVERSATION = "19:conv@thread.v2";
const OUT: OutboundMessage = { channel: { id: CONVERSATION, type: "group" }, text: "hello" };
const EDIT = { type: "message", text: "hello" };

function realConversations(App: new (cfg: unknown) => unknown): RealConversations {
  const app = new App({ clientId: "client-1", clientSecret: "secret-1", tenantId: "tenant-1" });
  return (app as { api: { conversations: RealConversations } }).api.conversations;
}

/** Stub the request on the SDK's own objects and record which call carried the edit. */
function interceptEdits(conversations: RealConversations): unknown[][] {
  const calls: unknown[][] = [];
  if (typeof conversations.updateActivity === "function") {
    vi.spyOn(conversations as Required<RealConversations>, "updateActivity").mockImplementation(
      async (...args: unknown[]) => {
        calls.push(args);
        return { id: "a1" };
      },
    );
  }
  const activities = conversations.activities.bind(conversations);
  vi.spyOn(conversations, "activities").mockImplementation((conversationId: string) => {
    const client = activities(conversationId);
    vi.spyOn(client, "update").mockImplementation(async (...args: unknown[]) => {
      calls.push([conversationId, ...args]);
      return { id: "a1" };
    });
    return client;
  });
  return calls;
}

function adapterOver(conversations: RealConversations): TeamsAdapter {
  return new TeamsAdapter({
    clientId: "client-1",
    clientSecret: "secret-1",
    tenantId: "tenant-1",
    __appFactory: () =>
      ({
        initialize: async () => undefined,
        start: async () => undefined,
        stop: async () => undefined,
        send: async () => ({ id: "sent-1" }),
        on: () => undefined,
        api: { conversations },
      }) as never,
    __tokenFetcher: async () => ({ ok: true, status: 200 }),
  });
}

describe("TeamsAdapter.editMessage against the installed SDK", () => {
  it.each(SDKS)("sends one edit through the conversation client of %s", async (_line, App) => {
    const conversations = realConversations(App as never);
    const calls = interceptEdits(conversations);
    const adapter = adapterOver(conversations);
    expect(await adapter.connect()).toBe(true);

    const result = await adapter.editMessage("a1", OUT);

    expect(result).toEqual({ ok: true, messageId: "a1" });
    expect(calls).toEqual([[CONVERSATION, "a1", EDIT]]);
    await adapter.disconnect();
  });

  it.each(SDKS)("keeps the activities(id).update fallback on %s", (_line, App) => {
    const conversations = realConversations(App as never);

    expect(typeof conversations.activities(CONVERSATION).update).toBe("function");
  });
});
