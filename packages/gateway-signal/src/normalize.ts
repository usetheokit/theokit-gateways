/**
 * signal-cli `receive` envelope → `SignalMessageEvent`.
 *
 * @public
 */

import type { SignalMessageEvent } from "@theokit/gateway";

/** The fields of a signal-cli envelope this package reads. Everything else stays in `raw`. */
export interface SignalEnvelope {
  readonly source?: string;
  readonly sourceNumber?: string;
  readonly sourceUuid?: string;
  readonly sourceName?: string;
  readonly timestamp?: number;
  readonly dataMessage?: {
    readonly timestamp?: number;
    readonly message?: string | null;
    readonly groupInfo?: { readonly groupId?: string };
  };
}

/** The `channel.id` prefix that marks a Signal group, so `sendMessage` can tell the two apart. */
export const GROUP_PREFIX = "group.";

/**
 * Build the event for one envelope, or `undefined` when it carries no message text.
 *
 * Receipts, typing notices, reactions and sync messages have no `dataMessage.message`, so they
 * produce no event rather than an empty one.
 *
 * @param envelope - the `params.envelope` of a signal-cli `receive` notification
 * @param receivedAt - when the adapter read it, in ms since the epoch
 */
export function signalEnvelopeToMessageEvent(
  envelope: SignalEnvelope,
  receivedAt: number,
): SignalMessageEvent | undefined {
  const text = messageText(envelope);
  if (text === undefined) return undefined;
  const number = envelope.sourceNumber ?? envelope.source;
  const senderId = envelope.sourceUuid ?? number;
  if (senderId === undefined) return undefined;
  const timestamp = sentAt(envelope, receivedAt);
  const groupId = envelope.dataMessage?.groupInfo?.groupId;
  return {
    id: `${senderId}:${timestamp}`,
    platform: "signal",
    sender: senderOf(senderId, envelope.sourceName),
    channel: channelOf(groupId, number ?? senderId),
    text,
    receivedAt,
    signal: signalFields(envelope, timestamp, number, groupId),
  };
}

/** The message text, or `undefined` for an envelope with none (receipt, typing, reaction, sync). */
function messageText(envelope: SignalEnvelope): string | undefined {
  const text = envelope.dataMessage?.message;
  return typeof text === "string" && text !== "" ? text : undefined;
}

/** When the sender sent it: the envelope's timestamp, the data message's, else `receivedAt`. */
function sentAt(envelope: SignalEnvelope, receivedAt: number): number {
  return envelope.timestamp ?? envelope.dataMessage?.timestamp ?? receivedAt;
}

/** The sender, with a display name only when the envelope carried a non-empty one. */
function senderOf(senderId: string, sourceName: string | undefined): SignalMessageEvent["sender"] {
  return sourceName ? { id: senderId, displayName: sourceName } : { id: senderId };
}

/** A group channel when the envelope names a group, else a dm addressed to `dmId`. */
function channelOf(groupId: string | undefined, dmId: string): SignalMessageEvent["channel"] {
  return groupId === undefined
    ? { id: dmId, type: "dm" }
    : { id: `${GROUP_PREFIX}${groupId}`, type: "group" };
}

/** The `signal` block, with each optional field present only when the envelope carried it. */
function signalFields(
  envelope: SignalEnvelope,
  timestamp: number,
  number: string | undefined,
  groupId: string | undefined,
): SignalMessageEvent["signal"] {
  return {
    timestamp,
    ...(number === undefined ? {} : { sourceNumber: number }),
    ...(envelope.sourceUuid === undefined ? {} : { sourceUuid: envelope.sourceUuid }),
    ...(groupId === undefined ? {} : { groupId }),
    raw: envelope,
  };
}
