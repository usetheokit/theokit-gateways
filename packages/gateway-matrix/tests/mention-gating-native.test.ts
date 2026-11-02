import type { MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MatrixAdapter } from "../src/adapter.js";
import type { MatrixSdkClient } from "../src/client.js";
import type { MatrixEventLike, MatrixRoomLike } from "../src/types.js";

const BOT = "@bot:matrix.org";

type Listener = (e: MatrixEventLike, r: MatrixRoomLike) => void;

function fakeClient(listeners: Listener[], calls: string[]): MatrixSdkClient {
  const record = (name: string) => () => {
    calls.push(name);
  };
  return {
    on(_evt: "Room.timeline", l: Listener) {
      listeners.push(l);
    },
    off: record("off"),
    whoami: record("whoami"),
    startClient: record("startClient"),
    stopClient: record("stopClient"),
    sendTextMessage: record("sendTextMessage"),
    getRoomIdForAlias: record("getRoomIdForAlias"),
    getRoom: () => null,
    isRoomEncrypted: () => false,
    getUserId: () => BOT,
  } as unknown as MatrixSdkClient;
}

function timelineEvent(content: Record<string, unknown>): MatrixEventLike {
  return {
    getId: () => "$evt:server",
    getSender: () => "@alice:matrix.org",
    getRoomId: () => "!r:server",
    getType: () => "m.room.message",
    getContent: () => ({ msgtype: "m.text", ...content }),
    getTs: () => Date.now(),
  };
}

const groupRoom: MatrixRoomLike = { roomId: "!r:server", getJoinedMemberCount: () => 5 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MatrixAdapter sync path mention gating (FR-001, FR-002, NFR-001)", () => {
  it("never hands an unmentioned group timeline event to the handler, and hands a mentioned one", async () => {
    const listeners: Listener[] = [];
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: BOT,
    });
    adapter._installClient(fakeClient(listeners, []));
    const received: MessageEvent[] = [];
    adapter.onInbound(async (event) => {
      received.push(event);
    });
    const listener = listeners[0];
    listener?.(timelineEvent({ body: "hello" }), groupRoom);
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toHaveLength(0);
    listener?.(timelineEvent({ body: "hi", "m.mentions": { user_ids: [BOT] } }), groupRoom);
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toHaveLength(1);
  });

  it("delivers the unmentioned group event when requireMention is false", async () => {
    const listeners: Listener[] = [];
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: BOT,
      requireMention: false,
    });
    adapter._installClient(fakeClient(listeners, []));
    const received: MessageEvent[] = [];
    adapter.onInbound(async (event) => {
      received.push(event);
    });
    listeners[0]?.(timelineEvent({ body: "hello" }), groupRoom);
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toHaveLength(1);
  });

  it("makes no network call and no client call for any gated event", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const listeners: Listener[] = [];
    const calls: string[] = [];
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: BOT,
    });
    adapter._installClient(fakeClient(listeners, calls));
    adapter.onInbound(async () => {});
    for (const content of [
      { body: "a" },
      { body: "b", "m.mentions": { user_ids: ["@carol:matrix.org"] } },
      { body: "c", "m.mentions": { room: true } },
    ]) {
      listeners[0]?.(timelineEvent(content), groupRoom);
    }
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    expect(calls).toEqual([]);
  });
});
