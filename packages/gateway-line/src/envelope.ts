import type { LineWebhookEnvelope } from "./types.js";

/** A LINE webhook envelope: an object whose `events` is an array of objects. */
export function isEnvelope(payload: unknown): payload is LineWebhookEnvelope {
  if (typeof payload !== "object" || payload === null) return false;
  const events = (payload as { events?: unknown }).events;
  return (
    Array.isArray(events) && events.every((event) => typeof event === "object" && event !== null)
  );
}
