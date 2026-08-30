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
 * Baileys reports seconds; every other backend here reports milliseconds, which is why the
 * caller multiplies.
 *
 * Returning `undefined` — which makes the caller drop the envelope — is this module's uniform
 * contract, not a special rule: it refuses anything it cannot fully read, exactly as it refuses
 * an unidentifiable sender or a non-text body. An earlier version of this comment justified the
 * drop by a "freshness window" that would reject stale messages. **No such window exists** —
 * `receivedAt` is declared in `@theokit/gateway` and read by nothing. A review caught the claim.
 * The replay defence in this backend is the `type !== "notify"` filter on `messages.upsert`.
 *
 * Worth knowing when comparing backends: `backend/cloud/webhook.ts` takes the opposite branch,
 * substituting the current time for an unreadable stamp. Neither is wrong given that nobody
 * reads the field; they are inconsistent, and that is recorded rather than quietly aligned.
 */
function toSeconds(timestamp: unknown): number | undefined {
  if (typeof timestamp === "number") return timestamp;
  if (typeof timestamp === "string") {
    const parsed = Number(timestamp);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  // Baileys' generated protobuf types permit a `Long`. Read as unparseable, a perfectly good
  // message from a real user would be dropped for a field nobody reads — so the shape is
  // handled rather than refused.
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
 * What the backend knows that a single envelope cannot carry.
 *
 * Both fields are optional and an absent one means "unknown", never "anything goes": with no
 * context the guard below behaves exactly as it did before this type existed.
 *
 * @public
 */
export interface BaileysDispatchContext {
  /**
   * The JIDs that ARE this account, normalised — its phone JID and its LID.
   *
   * A set rather than one id because the self-chat is addressed by LID, not by phone JID, and
   * both forms reach the socket. An EMPTY set means the backend has not learned them yet, and
   * the safe reading of "we do not know which chat is the self-chat" is not "every chat is".
   */
  readonly selfJids?: ReadonlySet<string>;
  /** Message ids this backend sent. Its own echoes — the thing that must never be answered. */
  readonly sentWamids?: ReadonlySet<string>;
}

/**
 * Should this envelope reach a handler at all?
 *
 * Refused: the status feed, which is never a conversation, and the replies THIS BACKEND sent —
 * or the bot answers itself, forever, a lesson every backend in this package learned separately.
 *
 * The second refusal used to be spelled `fromMe`, and that was broader than the reason written
 * beside it. `fromMe` does not mean "we sent it"; it means "this ACCOUNT sent it", which includes
 * the human typing on their own phone. Measured against a real paired account on 2026-08-30: a
 * note-to-self arrives as live traffic (`upsert type=notify`, with content) and was discarded for
 * that reason alone — foreclosing the note-to-self agent, which is what this gateway family exists
 * for. Every other gateway here answers it, because there the bot is a separate identity; on
 * WhatsApp the paired account IS the person.
 *
 * So the refusal now aims at what actually causes the loop — an id we sent — and stays inside the
 * self-chat. A message the owner sent to SOMEBODY ELSE is still refused: answering there would put
 * the agent into a third party's conversation, in the owner's name, triggered by the owner's own
 * words.
 */
function isDispatchable(
  key: Record<string, unknown>,
  remoteJid: string,
  wamid: string,
  ctx: BaileysDispatchContext | undefined,
): "no" | "yes" | "yes-from-self" {
  if (remoteJid === STATUS_BROADCAST_JID) return "no";
  if (key.fromMe !== true) return "yes";

  const selfJids = ctx?.selfJids;
  if (selfJids === undefined || selfJids.size === 0) return "no";
  if (!selfJids.has(normalizeWhatsAppId(remoteJid))) return "no";
  return ctx?.sentWamids?.has(wamid) === true ? "no" : "yes-from-self";
}

/** The envelope's addressing, once every field it needs has been read and none was missing. */
interface Addressed {
  readonly key: Record<string, unknown>;
  readonly remoteJid: string;
  readonly wamid: string;
}

/**
 * Read the envelope's addressing, or refuse it.
 *
 * Split from {@link normalizeBaileysMessage} because the two halves answer different questions:
 * this one asks whether the envelope IS one — has a key, a chat, an id — and the caller asks
 * whether it should be delivered. Together they read as one ladder of early returns, which is
 * what pushed the function past its complexity budget when the dispatch verdict grew a third
 * outcome.
 */
function addressingOf(envelope: RawEnvelope | undefined): Addressed | undefined {
  const key = envelope === undefined ? undefined : asObject(envelope.key);
  if (key === undefined) return undefined;
  const remoteJid = asText(key.remoteJid);
  const wamid = asText(key.id);
  if (remoteJid === undefined || wamid === undefined) return undefined;
  return { key, remoteJid, wamid };
}

/**
 * Normalise one inbound envelope, or refuse it.
 *
 * Refused: the replies this backend sent, messages this account sent OUTSIDE its own self-chat,
 * the status feed, any content that is not text, and anything whose sender cannot be identified.
 * That last one matters most — an event with an unidentifiable sender would reach an allowlist
 * with nothing to match against, and the safe reading of "we do not know who sent this" is not
 * "let it through". See {@link BaileysDispatchContext} for what the backend must supply before a
 * note-to-self can be answered at all.
 */
export function normalizeBaileysMessage(
  raw: unknown,
  ctx?: BaileysDispatchContext,
): WhatsAppInboundEvent | undefined {
  const envelope = asObject(raw) as RawEnvelope | undefined;
  const addressed = addressingOf(envelope);
  if (addressed === undefined) return undefined;

  const { key, remoteJid, wamid } = addressed;
  const verdict = isDispatchable(key, remoteJid, wamid, ctx);
  if (verdict === "no") return undefined;

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
    ...(verdict === "yes-from-self" ? { fromSelf: true } : {}),
    ...(contactName !== undefined ? { contactName } : {}),
  };
}
