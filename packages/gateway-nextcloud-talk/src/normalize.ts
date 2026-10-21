/**
 * A verified Talk webhook body to a `NextcloudTalkMessageEvent`.
 *
 * @public
 */

import type { NextcloudTalkMessageEvent } from "@theokit/gateway";

/**
 * The fields of a Talk bot webhook body the adapter reads. Talk sends ActivityStreams-shaped JSON;
 * the Q6 probe recorded `Join` and `Create` bodies of this shape on spreed 21.1.11.
 *
 * @public
 */
export interface TalkWebhookBody {
  readonly type?: string;
  readonly actor?: { readonly type?: string; readonly id?: string; readonly name?: string };
  readonly object?: {
    readonly id?: string;
    /** A JSON string, `{"message": "...", "parameters": {...}}`. */
    readonly content?: string;
    readonly inReplyTo?: { readonly object?: { readonly id?: string } };
  };
  readonly target?: { readonly id?: string };
}

/** Why a body gave no event: `ignored` is expected traffic, the others are logged by the caller. */
export type TalkBodyOutcome =
  | { readonly kind: "event"; readonly event: NextcloudTalkMessageEvent }
  | { readonly kind: "ignored" }
  | { readonly kind: "unreadable"; readonly reason: string };

/**
 * Read one verified body. A `Create` from a `Person` with a room, an id and a readable `content`
 * becomes an event whose channel is the room, a `group`; any other activity (`Join`, `Leave`, a
 * message from a bot or a federated `Application`) is `ignored`. A `Create` from a person whose
 * `content` is not JSON with a string `message` is `unreadable`.
 *
 * @param body - the parsed webhook body
 * @param receivedAt - when it arrived, in ms since the epoch
 * @public
 */
export function talkBodyToMessageEvent(body: TalkWebhookBody, receivedAt: number): TalkBodyOutcome {
  const { actor, object, target } = body;
  if (body.type !== "Create" || actor?.type !== "Person") return { kind: "ignored" };
  if (actor.id === undefined || object?.id === undefined || target?.id === undefined) {
    return { kind: "unreadable", reason: "a Create without actor.id, object.id or target.id" };
  }
  const text = messageOf(object.content);
  if (text === undefined) {
    return { kind: "unreadable", reason: `message ${object.id}: its content is not Talk's JSON` };
  }
  const replyToId = object.inReplyTo?.object?.id;
  return {
    kind: "event",
    event: {
      id: object.id,
      platform: "nextcloud_talk",
      sender: { id: actor.id, displayName: actor.name ?? actor.id },
      channel: { id: target.id, type: "group" },
      text,
      receivedAt,
      nextcloud_talk: {
        roomToken: target.id,
        messageId: object.id,
        actorId: actor.id,
        ...(replyToId === undefined ? {} : { replyToId }),
        raw: body,
      },
    },
  };
}

/** The `message` field of Talk's JSON `content`, or `undefined` when it is not there. */
function messageOf(content: string | undefined): string | undefined {
  if (content === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const message = (parsed as { message?: unknown }).message;
    return typeof message === "string" ? message : undefined;
  } catch {
    return undefined;
  }
}
