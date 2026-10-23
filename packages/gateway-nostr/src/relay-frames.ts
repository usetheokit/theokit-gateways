/**
 * Pure helpers of the relay client: frame parsing and the filters sent again after a reconnect.
 */

import type { Filter } from "nostr-tools/filter";
import type { NostrEvent } from "nostr-tools/pure";

/** NIP-59 dates a gift wrap up to two days in the past, so a newer DM can carry an older wrap. */
const GIFT_WRAP_BACKDATE_S = 172_800;
/** Ten minutes more, for the clock skew between the sender and this process. */
const CLOCK_SKEW_S = 600;
const GIFT_WRAP = 1059;

/**
 * The filters to send on (re)subscription. A kind 1059 filter asks from far enough back to cover a
 * gift wrap dated two days before the newest one seen (EC-2); the seen-id set absorbs the replays.
 * The adapter's own filter starts at `ignoreBefore` minus the same margin, so the minimum below is
 * `min(ignoreBefore, lastSeen)` minus that margin, as the plan states it.
 */
export function resubscribeFilters(
  filters: readonly Filter[],
  lastSeen: number | undefined,
): Filter[] {
  return filters.map((filter) => {
    if (lastSeen === undefined || !filter.kinds?.includes(GIFT_WRAP)) return { ...filter };
    const floor = lastSeen - GIFT_WRAP_BACKDATE_S - CLOCK_SKEW_S;
    return { ...filter, since: Math.min(filter.since ?? floor, floor) };
  });
}

/** One relay frame: a JSON array, or `undefined` for anything else. */
export function parseFrame(data: unknown): unknown[] | undefined {
  if (typeof data !== "string") return undefined;
  try {
    const frame: unknown = JSON.parse(data);
    return Array.isArray(frame) ? frame : undefined;
  } catch {
    // A relay that sends something other than JSON is ignored, as NIP-01 relays ignore bad frames.
    return undefined;
  }
}

/** Whether a relay sent something shaped like a signed Nostr event. */
export function isEvent(value: unknown): value is NostrEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Partial<NostrEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.pubkey === "string" &&
    typeof event.created_at === "number" &&
    typeof event.kind === "number" &&
    typeof event.content === "string" &&
    Array.isArray(event.tags)
  );
}

/** The message of a thrown value. */
export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
