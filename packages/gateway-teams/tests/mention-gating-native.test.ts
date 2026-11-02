import type { MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TeamsAdapter } from "../src/adapter.js";

const BOT_ID = "28:bot-id";

function makeFakeApp() {
  const handlers: Record<string, (e: unknown) => Promise<void> | void> = {};
  return {
    initialize: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    send: vi.fn(async () => ({ id: "sent-1" })),
    on: vi.fn((name: string, cb: (e: unknown) => void | Promise<void>) => {
      handlers[name] = cb;
    }),
    emit(event: unknown) {
      return handlers.activity?.(event);
    },
  };
}

async function connected(requireMention?: boolean) {
  const app = makeFakeApp();
  const adapter = new TeamsAdapter({
    clientId: "client-1",
    clientSecret: "secret-1",
    tenantId: "tenant-1",
    ...(requireMention === undefined ? {} : { requireMention }),
    __appFactory: () => app as never,
    __tokenFetcher: async () => ({ ok: true, status: 200 }),
  });
  await adapter.connect();
  const received: MessageEvent[] = [];
  adapter.onInbound(async (event) => {
    received.push(event);
  });
  return { adapter, app, received };
}

function groupActivity(extra: Record<string, unknown>) {
  return {
    activity: {
      type: "message",
      id: "act-1",
      text: "hi",
      conversation: { id: "conv-1", conversationType: "channel" },
      from: { id: "u1" },
      ...extra,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TeamsAdapter activity path mention gating (FR-001, FR-002, FR-008, NFR-001)", () => {
  it("never hands an unmentioned channel activity to the handler, and hands a mentioned one", async () => {
    const { app, received } = await connected();
    await app.emit(groupActivity({ recipient: { id: BOT_ID }, entities: [] }));
    expect(received).toHaveLength(0);
    await app.emit(
      groupActivity({
        recipient: { id: BOT_ID },
        entities: [{ type: "mention", mentioned: { id: BOT_ID } }],
      }),
    );
    expect(received).toHaveLength(1);
  });

  it("drops 3 group activities with no recipient and writes exactly one stderr line", async () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { app, received } = await connected();
    for (let i = 0; i < 3; i += 1) await app.emit(groupActivity({ entities: [] }));
    expect(received).toHaveLength(0);
    const lines = write.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes("requireMention is on and the activity names no recipient id"));
    expect(lines).toEqual([
      "[teams] dropping group messages: requireMention is on and the activity names no recipient id\n",
    ]);
  });

  it("makes no network call and no app call for any gated event", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { app } = await connected();
    const sendCalls = app.send.mock.calls.length;
    await app.emit(groupActivity({ recipient: { id: BOT_ID }, entities: [] }));
    await app.emit(
      groupActivity({
        recipient: { id: BOT_ID },
        entities: [{ type: "mention", mentioned: { id: "29:other" } }],
      }),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    expect(app.send.mock.calls.length).toBe(sendCalls);
  });
});
