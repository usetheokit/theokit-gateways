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
  const text = envelope.dataMessage?.message;
  if (typeof text !== "string" || text === "") return undefined;
  const number = envelope.sourceNumber ?? envelope.source;
  const senderId = envelope.sourceUuid ?? number;
  if (senderId === undefined) return undefined;
  const timestamp = envelope.timestamp ?? envelope.dataMessage?.timestamp ?? receivedAt;
  const groupId = envelope.dataMessage?.groupInfo?.groupId;
  return {
    id: `${senderId}:${timestamp}`,
    platform: "signal",
    sender: envelope.sourceName
      ? { id: senderId, displayName: envelope.sourceName }
      : { id: senderId },
    channel:
      groupId === undefined
        ? { id: number ?? senderId, type: "dm" }
        : { id: `${GROUP_PREFIX}${groupId}`, type: "group" },
    text,
    receivedAt,
    signal: signalFields(envelope, timestamp, number, groupId),
  };
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
