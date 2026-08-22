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
function extractText(message: Record<string, unknown> | undefined): string | undefined {
  if (message === undefined) return undefined;
  const direct = asText(message.conversation);
  if (direct !== undefined) return direct;
  const extended = asObject(message.extendedTextMessage);
  return extended === undefined ? undefined : asText(extended.text);
}

/**
 * Seconds since the epoch, as Baileys reports them, in milliseconds.
 *
 * Every other backend here reports milliseconds, and `receivedAt` feeds the freshness window
 * that stops a restarting bot answering history it can still see. A thousand-fold error there
 * would place every message in 1970 and make the window admit everything.
 */
function toMillis(timestamp: unknown): number {
  const seconds =
    typeof timestamp === "number"
      ? timestamp
      : typeof timestamp === "string"
        ? Number(timestamp)
        : Number.NaN;
  return Number.isFinite(seconds) ? seconds * 1_000 : Date.now();
}

/**
 * Normalise one inbound envelope, or refuse it.
 *
 * Refused: anything we sent (`fromMe`), the status feed, any content that is not text, and
 * anything whose sender cannot be identified. That last one matters most — an event with an
 * unidentifiable sender would reach an allowlist that has nothing to match against, and the
 * safe reading of "we do not know who sent this" is not "let it through".
 */
export function normalizeBaileysMessage(raw: unknown): WhatsAppInboundEvent | undefined {
  const envelope = asObject(raw) as RawEnvelope | undefined;
  const key = envelope === undefined ? undefined : asObject(envelope.key);
  if (key === undefined) return undefined;
  if (key.fromMe === true) return undefined;

  const remoteJid = asText(key.remoteJid);
  const wamid = asText(key.id);
  if (remoteJid === undefined || wamid === undefined) return undefined;
  if (remoteJid === STATUS_BROADCAST_JID) return undefined;

  const text = extractText(envelope?.message);
  if (text === undefined) return undefined;

  const isGroup = remoteJid.endsWith("@g.us");
  // In a group the channel is the group and the sender is the participant. Reading remoteJid
  // as the sender would attribute every group message to the group, which breaks the
  // allowlist and any per-sender session key at once.
  const senderJid = isGroup ? asText(key.participant) : remoteJid;
  if (senderJid === undefined) return undefined;

  const fromPhone = normalizeWhatsAppId(senderJid);
  const channelId = normalizeWhatsAppId(remoteJid);
  if (fromPhone.length === 0 || channelId.length === 0) return undefined;

  const contactName = asText(envelope?.pushName);

  return {
    wamid,
    fromPhone,
    conversationType: isGroup ? "group" : "dm",
    channelId,
    text,
    receivedAt: toMillis(envelope?.messageTimestamp),
    backend: "baileys",
    raw,
    ...(contactName !== undefined ? { contactName } : {}),
  };
}
