/**
 * Webhook helpers for Meta WhatsApp Business Cloud API (ADR D306, D312).
 *
 * Two boundaries:
 *   1. GET handshake — `verifyWebhookSubscription` (EC-1).
 *   2. POST callbacks — `verifyWebhookSignature` (EC-3 length guard) +
 *      `normalizeInboundMessages` (EC-4 text-only filter) +
 *      `normalizeStatusReceipts`.
 *
 * The user owns the HTTP route; we expose pure helpers they call from inside it.
 *
 * @public
 */

import type { WhatsAppInboundEvent, WhatsAppStatusReceipt } from "../../backend-types.js";
import type { MetaIncomingMessage, MetaStatusUpdate, MetaWebhookEnvelope } from "./types.js";

const warnedNonTextTypes = new Set<string>();

/**
 * Verify Meta's GET `/webhook?hub.mode=subscribe&hub.challenge=...&hub.verify_token=...`
 * handshake (EC-1 absorbed).
 *
 * @returns `query["hub.challenge"]` when valid, `null` otherwise. The caller
 * echoes the challenge as `text/plain` on success.
 */
export function verifyWebhookSubscription(
  query: Record<string, string | undefined>,
  expectedVerifyToken: string,
): string | null {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode !== "subscribe") return null;
  if (token === undefined || token !== expectedVerifyToken) return null;
  if (challenge === undefined || challenge.length === 0) return null;
  return challenge;
}

// The signature check lives in its own module so mutation testing can measure it without the
// normalizers below (see tests/MUTATION.md); it is re-exported so the import path is unchanged.
export { verifyWebhookSignature } from "./signature.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/** Absent, or an array whose every item is an object: what the normalizers iterate. */
function isOptionalRecordArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every(isRecord));
}

/** A change's `value`: absent, or an object whose lists are lists of objects. */
function isWellFormedValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!isRecord(value)) return false;
  return (
    isOptionalRecordArray(value.contacts) &&
    isOptionalRecordArray(value.messages) &&
    isOptionalRecordArray(value.statuses)
  );
}

function isWellFormedEntry(entry: unknown): boolean {
  if (!isRecord(entry) || !Array.isArray(entry.changes)) return false;
  return entry.changes.every((change) => isRecord(change) && isWellFormedValue(change.value));
}

/**
 * Parse the raw JSON payload into a typed envelope, or `null` when its shape is not one the
 * normalizers can read: no `object`, an `entry` that is not an array, or any entry, change or
 * listed contact, message or status that is not an object (an entry with no `changes` array, a
 * `null` change, `messages: 5`). The whole body is refused rather than its bad entries skipped, so
 * nothing in a batch is dropped without the route seeing it. Past a non-null result neither
 * normalizer throws. The fields of each message and status are not checked here.
 */
export function parseWebhookPayload(json: unknown): MetaWebhookEnvelope | null {
  if (!isRecord(json)) return null;
  if (json.object === undefined || !Array.isArray(json.entry)) return null;
  if (!json.entry.every(isWellFormedEntry)) return null;
  return json as unknown as MetaWebhookEnvelope;
}

/**
 * Normalize inbound messages → `WhatsAppInboundEvent[]`.
 *
 * EC-4 absorbed: filters `message.type !== "text"` (v1 text-only). Non-text
 * types emit a one-shot stderr warn per type.
 */
function buildContactMap(
  value: NonNullable<MetaWebhookEnvelope["entry"][number]["changes"][number]["value"]>,
): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>();
  for (const c of value.contacts ?? []) map.set(c.wa_id, c.profile?.name);
  return map;
}

function processChange(
  change: MetaWebhookEnvelope["entry"][number]["changes"][number],
  out: WhatsAppInboundEvent[],
): void {
  const value = change.value;
  if (value === undefined || value === null) return;
  const phoneNumberId = value.metadata?.phone_number_id;
  const contactByWaId = buildContactMap(value);
  for (const msg of value.messages ?? []) {
    const normalized = normalizeOneMessage(msg, phoneNumberId, contactByWaId);
    if (normalized !== null) out.push(normalized);
  }
}

/**
 * Extract the inbound messages from one Meta webhook envelope.
 *
 * A single delivery batches entries, changes and messages, and may carry none at all — a
 * status-only delivery is normal. Returns an array, empty when there is nothing to hand on.
 */
export function normalizeInboundMessages(envelope: MetaWebhookEnvelope): WhatsAppInboundEvent[] {
  const out: WhatsAppInboundEvent[] = [];
  for (const entry of envelope.entry) {
    for (const change of entry.changes) processChange(change, out);
  }
  return out;
}

function normalizeOneMessage(
  msg: MetaIncomingMessage,
  phoneNumberId: string | undefined,
  contactByWaId: Map<string, string | undefined>,
): WhatsAppInboundEvent | null {
  // EC-4: text-only in v1.
  if (msg.type !== "text") {
    if (!warnedNonTextTypes.has(msg.type)) {
      warnedNonTextTypes.add(msg.type);
      process.stderr.write(
        `[whatsapp] ignoring ${msg.type} message — v1 text-only (will be supported in v0.2+).\n`,
      );
    }
    return null;
  }
  const body = msg.text?.body ?? "";
  // Cloud API doesn't distinguish DM vs group at the message level — `from`
  // is the sender. We don't have a reliable group-detection signal in cloud
  // (groups need a different webhook subscription). v1 treats all inbound
  // as DM. If the user enables group webhooks, the `conversationType` heuristic
  // here is a future-extension point.
  return {
    wamid: msg.id,
    fromPhone: msg.from,
    phoneNumberId,
    contactName: contactByWaId.get(msg.from),
    conversationType: "dm",
    channelId: msg.from,
    text: body,
    receivedAt: Number(msg.timestamp) * 1000 || Date.now(),
    backend: "cloud",
    raw: msg,
  };
}

/** Normalize status updates → `WhatsAppStatusReceipt[]`. */
export function normalizeStatusReceipts(envelope: MetaWebhookEnvelope): WhatsAppStatusReceipt[] {
  const out: WhatsAppStatusReceipt[] = [];
  for (const entry of envelope.entry) {
    for (const change of entry.changes) {
      const phoneNumberId = change.value?.metadata?.phone_number_id;
      for (const s of change.value?.statuses ?? []) {
        out.push(metaStatusToReceipt(s, phoneNumberId));
      }
    }
  }
  return out;
}

function metaStatusToReceipt(
  s: MetaStatusUpdate,
  phoneNumberId: string | undefined,
): WhatsAppStatusReceipt {
  const receipt = {
    wamid: s.id,
    status: s.status,
    recipient: s.recipient_id,
    timestamp: Number(s.timestamp) * 1000 || Date.now(),
  };
  return phoneNumberId === undefined ? receipt : { ...receipt, phoneNumberId };
}

/** @internal — test seam to reset the one-shot warn de-dup. */
export function __resetNonTextWarnings(): void {
  warnedNonTextTypes.clear();
}
