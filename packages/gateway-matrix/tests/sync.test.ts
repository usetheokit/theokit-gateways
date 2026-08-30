import { describe, expect, it, vi } from "vitest";

import { shouldDispatchSyncEvent, subscribeToTimeline } from "../src/sync.js";
import type { MatrixEventLike, MatrixRoomLike } from "../src/types.js";

function makeEvent(opts: Partial<{ type: string; sender: string; ts: number }>): MatrixEventLike {
  const type = opts.type ?? "m.room.message";
  const sender = opts.sender ?? "@alice:matrix.org";
  const ts = opts.ts ?? Date.now();
  return {
    getId: () => "evt-1",
    getSender: () => sender,
    getRoomId: () => "!r:server",
    getType: () => type,
    getContent: () => ({ body: "hi", msgtype: "m.text" }),
    getTs: () => ts,
  };
}

function makeRoom(): MatrixRoomLike {
  return { roomId: "!r:server", getJoinedMemberCount: () => 2 };
}

describe("shouldDispatchSyncEvent (D415, EC-3)", () => {
  const baseOpts = { botUserId: "@bot:matrix.org", freshnessWindowMs: 60_000 };
  const now = 1_700_000_000_000;

  it("D413: drops non-message event types", () => {
    expect(shouldDispatchSyncEvent(makeEvent({ type: "m.reaction" }), baseOpts, now)).toBe(false);
    expect(shouldDispatchSyncEvent(makeEvent({ type: "m.typing" }), baseOpts, now)).toBe(false);
  });

  it("loop guard: drops bot's own messages", () => {
    expect(
      shouldDispatchSyncEvent(makeEvent({ sender: "@bot:matrix.org", ts: now }), baseOpts, now),
    ).toBe(false);
  });

  it("EC-3: drops events older than freshness window (60s default)", () => {
    expect(shouldDispatchSyncEvent(makeEvent({ ts: now - 90_000 }), baseOpts, now)).toBe(false);
  });

  it("EC-3: events 1ms older than the boundary are dropped (exclusive)", () => {
    expect(shouldDispatchSyncEvent(makeEvent({ ts: now - 60_001 }), baseOpts, now)).toBe(false);
  });

  it("EC-3: events exactly at the boundary dispatch (inclusive)", () => {
    expect(shouldDispatchSyncEvent(makeEvent({ ts: now - 60_000 }), baseOpts, now)).toBe(true);
  });

  it("EC-3: events within window dispatch", () => {
    expect(shouldDispatchSyncEvent(makeEvent({ ts: now - 5_000 }), baseOpts, now)).toBe(true);
  });

  it("EC-3: fresh event from another user dispatches", () => {
    expect(
      shouldDispatchSyncEvent(
        makeEvent({ sender: "@alice:matrix.org", ts: now - 1_000 }),
        baseOpts,
        now,
      ),
    ).toBe(true);
  });
});

describe("subscribeToTimeline", () => {
  it("wraps the listener with filter and returns unsubscribe", () => {
    let registered: ((e: MatrixEventLike, r: MatrixRoomLike) => void) | undefined;
    let removed: ((e: MatrixEventLike, r: MatrixRoomLike) => void) | undefined;
    let onEvent: string | undefined;
    let offEvent: string | undefined;
    const client = {
      // The event NAME is recorded, not discarded. It was `_evt` — unread — so `"Room.timeline"`
      // could be the empty string in both calls with this test still green, and an adapter that
      // subscribes under the wrong name receives nothing at all while looking perfectly wired.
      on(evt: string, l: (e: MatrixEventLike, r: MatrixRoomLike) => void) {
        onEvent = evt;
        registered = l;
      },
      off(evt: string, l: (e: MatrixEventLike, r: MatrixRoomLike) => void) {
        offEvent = evt;
        removed = l;
      },
    };
    const handler = vi.fn();
    const sub = subscribeToTimeline(client, handler, {
      botUserId: "@bot:matrix.org",
      freshnessWindowMs: 60_000,
    });
    expect(registered).toBeDefined();
    // Drop event from bot → handler NOT called.
    registered?.(makeEvent({ sender: "@bot:matrix.org" }), makeRoom());
    expect(handler).not.toHaveBeenCalled();
    // Fresh event from alice → handler called.
    registered?.(makeEvent({ sender: "@alice:matrix.org" }), makeRoom());
    expect(handler).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
    expect(removed).toBe(registered);
    // Subscribing and unsubscribing must name the SAME event, and it must be the one Matrix emits.
    expect(onEvent).toBe("Room.timeline");
    expect(offEvent).toBe("Room.timeline");
  });
});
