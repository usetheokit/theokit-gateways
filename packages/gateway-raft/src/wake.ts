/**
 * Parse one line printed by the Raft CLI wake bridge into a gateway event.
 *
 * A wake line is a JSON object: `id` (string), `text` (string), and `from` (who woke the agent);
 * `conversation` names where a reply goes and defaults to `from`; `ts` is epoch milliseconds.
 */

import type { MessageEvent as GatewayMessageEvent } from "@theokit/gateway";

/** The event for a wake line, or `undefined` when the line is not a usable wake. */
export function parseRaftWake(line: string): GatewayMessageEvent | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const w = raw as Record<string, unknown>;
  const id = scalar(w.id);
  const text = w.text;
  const from = scalar(w.from);
  if (id === "" || from === "" || typeof text !== "string" || text === "") return undefined;
  const conversation = scalar(w.conversation) || from;
  const ts = typeof w.ts === "number" && Number.isFinite(w.ts) && w.ts > 0 ? w.ts : Date.now();
  return {
    id,
    platform: "raft",
    sender: { id: from },
    channel: { id: conversation, type: "dm" },
    text,
    receivedAt: ts,
    raft: { messageId: id, senderId: from, raw },
  } as GatewayMessageEvent;
}

function scalar(v: unknown): string {
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
}
