/**
 * Sync timeline filter (D415, EC-3 absorbed).
 *
 * Wraps `client.on("Room.timeline", listener)` with 3 filters:
 *
 * 1. Drop non-`m.room.message` events (D413).
 * 2. Drop bot's own messages (loop guard, D275 mirror).
 * 3. **EC-3**: drop events older than `freshnessWindowMs` (default 60s)
 *    — initial sync from `matrix-js-sdk` delivers ~10 historical events
 *    per joined room, which would otherwise trigger an LLM-call storm.
 */

import type { MatrixEventLike, MatrixRoomLike } from "./types.js";

export interface SyncFilterOpts {
  readonly botUserId: string;
  readonly freshnessWindowMs: number;
}

/**
 * Decide whether a timeline event should reach the handler.
 *
 * Matrix replays room history on sync, so a freshly started bot would otherwise answer every message
 * it can still see — which is a reply storm in a busy room and an infinite loop in a quiet one. This
 * drops the bot's own events and anything older than the freshness window. `now` is injectable so
 * the decision is testable without waiting.
 */
export function shouldDispatchSyncEvent(
  event: MatrixEventLike,
  opts: SyncFilterOpts,
  now = Date.now(),
): boolean {
  if (event.getType() !== "m.room.message") return false;
  const sender = event.getSender();
  if (sender === opts.botUserId) return false;
  if (event.getTs() < now - opts.freshnessWindowMs) return false;
  return true;
}

/** A live timeline listener, with the handle that detaches it again. */
export interface TimelineSubscription {
  unsubscribe(): void;
}

/**
 * The slice of `matrix-js-sdk`'s client this adapter actually uses.
 *
 * Narrow on purpose: it is what lets the sync logic be tested against a few lines of fake rather
 * than a running homeserver, and it states the real coupling to the SDK — two event methods.
 */
export interface MatrixClientLike {
  on(event: "Room.timeline", listener: (e: MatrixEventLike, r: MatrixRoomLike) => void): void;
  off(event: "Room.timeline", listener: (e: MatrixEventLike, r: MatrixRoomLike) => void): void;
}

/**
 * Attach `handler` to the client's room timeline, filtered by {@link shouldDispatchSyncEvent}.
 *
 * Returns the subscription rather than leaving the listener attached forever: an adapter that
 * reconnects without detaching accumulates listeners, and every inbound message is then handled
 * once per reconnect.
 */
export function subscribeToTimeline(
  client: MatrixClientLike,
  handler: (event: MatrixEventLike, room: MatrixRoomLike) => void,
  opts: SyncFilterOpts,
): TimelineSubscription {
  const wrapped = (event: MatrixEventLike, room: MatrixRoomLike): void => {
    if (!shouldDispatchSyncEvent(event, opts)) return;
    handler(event, room);
  };
  client.on("Room.timeline", wrapped);
  return {
    unsubscribe(): void {
      client.off("Room.timeline", wrapped);
    },
  };
}
