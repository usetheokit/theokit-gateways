/**
 * `imsg` `message` notification → `IMessageMessageEvent`.
 *
 * @public
 */

import type { IMessageMessageEvent } from "@theokit/gateway";

/** The fields of an `imsg` message row this package reads. Everything else stays in `raw`. */
export interface IMessageRow {
  /** The row id in the Messages database; the cursor `since_rowid` resumes after. */
  readonly id?: number;
  readonly chat_id?: number;
  readonly guid?: string;
  readonly sender?: string;
  readonly is_from_me?: boolean;
  readonly text?: string | null;
  readonly is_group?: boolean;
  readonly participants?: readonly string[];
}

/**
 * Build the event for one row, or `undefined` when the handler must not see it.
 *
 * A row the signed-in account sent (`is_from_me`), including the adapter's own replies, gives no
 * event, and neither does a row with no text (an attachment, a tapback) or with no chat or guid.
 *
 * @param row - the `params.message` of an `imsg` `message` notification
 * @param receivedAt - when the adapter read it, in ms since the epoch
 */
export function imessageRowToMessageEvent(
  row: IMessageRow,
  receivedAt: number,
): IMessageMessageEvent | undefined {
  if (row.is_from_me !== false) return undefined;
  const { text, chat_id: chatId, guid, sender } = row;
  if (typeof text !== "string" || text === "") return undefined;
  if (typeof chatId !== "number" || typeof guid !== "string" || typeof sender !== "string") {
    return undefined;
  }
  const isGroup = row.is_group === true;
  return {
    id: guid,
    platform: "imessage",
    sender: { id: sender },
    channel: { id: String(chatId), type: isGroup ? "group" : "dm" },
    text,
    receivedAt,
    imessage: { chatId, guid, isGroup, participants: row.participants ?? [], raw: row },
  };
}
