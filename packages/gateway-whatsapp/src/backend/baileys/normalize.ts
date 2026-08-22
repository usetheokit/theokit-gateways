/**
 * Baileys envelope → `WhatsAppInboundEvent`. Pure: no socket, no clock, no I/O.
 *
 * Purity is the point rather than a preference. Nothing in this repository can exercise the
 * WhatsApp protocol — pairing needs a human with a phone — so the only part of this backend
 * that can be tested exhaustively is the part that does not touch the network. Every decision
 * that can live here does.
 *
 * It returns `undefined` rather than throwing for anything it will not accept. The input
 * arrives straight off a socket from a library that has shipped a message-spoofing advisory
 * (`GHSA-qvv5-jq5g-4cgg`), so a malformed or hostile envelope is an expected case, not an
 * exceptional one — and a throw here would take down whatever is dispatching.
 *
 * @internal
 */

import { normalizeWhatsAppId } from "../../allowlist.js";
import type { WhatsAppInboundEvent } from "../../backend-types.js";

/** WhatsApp's status feed. Never a conversation, always noise for a bot. */
const STATUS_BROADCAST_JID = "status@broadcast";

/** Envelopes that carry the real message one level down. */
const WRAPPER_KEYS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "documentWithCaptionMessage",
] as const;

/** How deep to follow nested wrappers before giving up. Hostile input must not recurse forever. */
const MAX_WRAPPER_DEPTH = 3;

/** The subset of a Baileys `WAMessage` this normaliser reads. */
interface RawEnvelope {
  key?: {
    remoteJid?: unknown;
    participant?: unknown;
    fromMe?: unknown;
    id?: unknown;
  };
  message?: Record<string, unknown>;
  messageTimestamp?: unknown;
  pushName?: unknown;
}

/** Narrow an unknown to an object without asserting anything about its members. */
function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A non-empty string, or undefined. */
function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The plain text of a message, from either shape Baileys uses.
 *
 * `conversation` carries a bare message; `extendedTextMessage` carries one with context — a
 * reply, a link preview, a mention. v1 is text-only, like the two sibling backends, so any
 * other content type yields undefined and the message is dropped.
 */
function extractText(message: Record<string, unknown> | undefined, depth = 0): string | undefined {
  if (message === undefined || depth > MAX_WRAPPER_DEPTH) return undefined;

  const direct = asText(message.conversation);
  if (direct !== undefined) return direct;

  const extended = asObject(message.extendedTextMessage);
  const fromExtended = extended === undefined ? undefined : asText(extended.text);
  if (fromExtended !== undefined) return fromExtended;

  // Baileys nests the real message inside a wrapper for disappearing messages and view-once.
  // Without unwrapping, every text sent in a chat with disappearing messages turned on was
  // dropped in silence — indistinguishable from an image, which the "v1 is text-only"
  // rationale was covering for.
  for (const wrapper of WRAPPER_KEYS) {
    const inner = asObject(message[wrapper]);
    const nested = inner === undefined ? undefined : asObject(inner.message);
    const text = extractText(nested, depth + 1);
    if (text !== undefined) return text;
  }
  return undefined;
}

/**
 * The message's timestamp in seconds, or `undefined` when it cannot be read.
 *
 * Baileys reports seconds; every other backend here reports milliseconds, and `receivedAt`
 * feeds the freshness window that stops a restarting bot answering history it can still see.
 *
 * Returning `undefined` rather than the current time is the point. "Unparseable" resolving to
 * "fresh" is the answer that defeats the window — a replayed message would arrive stamped now
 * and pass any check. The caller drops the message instead.
 */
function toSeconds(timestamp: unknown): number | undefined {
  if (typeof timestamp === "number") return timestamp;
  if (typeof timestamp === "string") {
    const parsed = Number(timestamp);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  // Baileys' generated protobuf types permit a `Long`. Reading it as unparseable and
  // substituting the current time would stamp a stale message "now" and walk it straight
  // through the freshness window this value exists to feed.
  const asLong = asObject(timestamp);
  if (asLong !== undefined && typeof asLong.toNumber === "function") {
    const parsed = (asLong.toNumber as () => unknown)();
    return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Who sent this, and where does it belong?
 *
 * In a group the channel is the group and the sender is the participant; in a DM both are
 * `remoteJid`. Reading `remoteJid` as the sender in a group would attribute every group
 * message to the group itself, which breaks the allowlist and any per-sender session key at
 * once. Returns `undefined` when either cannot be identified — and "we do not know who sent
 * this" must never resolve to "let it through".
 */
function resolveParties(
  key: Record<string, unknown>,
  remoteJid: string,
): { fromPhone: string; channelId: string; isGroup: boolean } | undefined {
  const isGroup = remoteJid.endsWith("@g.us");
  const senderJid = isGroup ? asText(key.participant) : remoteJid;
  if (senderJid === undefined) return undefined;

  const fromPhone = normalizeWhatsAppId(senderJid);
  const channelId = normalizeWhatsAppId(remoteJid);
  if (fromPhone.length === 0 || channelId.length === 0) return undefined;
  return { fromPhone, channelId, isGroup };
}

/**
 * Should this envelope reach a handler at all?
 *
 * Refused: anything we sent (or the bot answers its own replies, forever — a lesson every
 * backend in this package learned separately), and the status feed, which is never a
 * conversation.
 */
function isDispatchable(key: Record<string, unknown>, remoteJid: string): boolean {
  if (key.fromMe === true) return false;
  return remoteJid !== STATUS_BROADCAST_JID;
}

/**
 * Normalise one inbound envelope, or refuse it.
 *
 * Refused: anything we sent (`fromMe`), the status feed, any content that is not text, and
 * anything whose sender cannot be identified. That last one matters most — an event with an
 * unidentifiable sender would reach an allowlist with nothing to match against, and the safe
 * reading of "we do not know who sent this" is not "let it through".
 */
export function normalizeBaileysMessage(raw: unknown): WhatsAppInboundEvent | undefined {
  const envelope = asObject(raw) as RawEnvelope | undefined;
  const key = envelope === undefined ? undefined : asObject(envelope.key);
  if (key === undefined) return undefined;

  const remoteJid = asText(key.remoteJid);
  const wamid = asText(key.id);
  if (remoteJid === undefined || wamid === undefined) return undefined;
  if (!isDispatchable(key, remoteJid)) return undefined;

  const text = extractText(envelope?.message);
  if (text === undefined) return undefined;

  const parties = resolveParties(key, remoteJid);
  if (parties === undefined) return undefined;

  const seconds = toSeconds(envelope?.messageTimestamp);
  if (seconds === undefined) return undefined;

  const contactName = asText(envelope?.pushName);

  return {
    wamid,
    fromPhone: parties.fromPhone,
    conversationType: parties.isGroup ? "group" : "dm",
    channelId: parties.channelId,
    text,
    receivedAt: seconds * 1_000,
    backend: "baileys",
    raw,
    ...(contactName !== undefined ? { contactName } : {}),
  };
}
