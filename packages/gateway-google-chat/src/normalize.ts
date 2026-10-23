/**
 * Google Chat `MESSAGE` event → `GoogleChatMessageEvent` (FR-027).
 *
 * @public
 */

import type { GoogleChatMessageEvent } from "@theokit/gateway";

/** The fields of a Chat interaction event this package reads. Everything else stays in `raw`. */
export interface GoogleChatEventBody {
  readonly type?: string;
  readonly user?: { readonly name?: string; readonly displayName?: string };
  readonly space?: { readonly name?: string; readonly type?: string; readonly spaceType?: string };
  readonly message?: {
    readonly name?: string;
    readonly text?: string;
    readonly argumentText?: string;
    readonly thread?: { readonly name?: string };
  };
}

/**
 * Build the event for one Chat interaction, or `undefined` when it is not a message with text.
 *
 * `argumentText` (the text without the app's @mention) wins over `text` when it holds anything
 * after trimming.
 *
 * @param body - the parsed request body Chat posted
 * @param receivedAt - when the adapter read it, in ms since the epoch
 */
export function chatEventToMessageEvent(
  body: GoogleChatEventBody,
  receivedAt: number,
): GoogleChatMessageEvent | undefined {
  if (body.type !== "MESSAGE") return undefined;
  const { message, space, user } = body;
  const messageName = message?.name;
  const spaceName = space?.name;
  const senderId = user?.name;
  const text = textOf(message);
  if (messageName === undefined || spaceName === undefined || senderId === undefined) {
    return undefined;
  }
  if (text === "") return undefined;
  return {
    id: messageName,
    platform: "google_chat",
    sender: user?.displayName ? { id: senderId, displayName: user.displayName } : { id: senderId },
    channel: { id: spaceName, type: isDirectMessage(space) ? "dm" : "group" },
    text,
    receivedAt,
    google_chat: chatFields(body, messageName, spaceName),
  };
}

/** `argumentText` trimmed when it holds anything, else `text`, else empty. */
function textOf(message: GoogleChatEventBody["message"]): string {
  const argument = message?.argumentText?.trim() ?? "";
  return argument === "" ? (message?.text ?? "") : argument;
}

/** A DM by the deprecated `type` or by the current `spaceType`. */
function isDirectMessage(space: GoogleChatEventBody["space"]): boolean {
  return space?.type === "DM" || space?.spaceType === "DIRECT_MESSAGE";
}

/** The `google_chat` block, with each optional field present only when Chat sent it. */
function chatFields(
  body: GoogleChatEventBody,
  messageName: string,
  spaceName: string,
): GoogleChatMessageEvent["google_chat"] {
  const spaceType = body.space?.spaceType;
  const threadName = body.message?.thread?.name;
  return {
    messageName,
    spaceName,
    ...(spaceType === undefined ? {} : { spaceType }),
    ...(threadName === undefined ? {} : { threadName }),
    raw: body,
  };
}
