/**
 * Translating a raw Telegram `Update` into the canonical `MessageEvent`.
 *
 * This is the gateway's half of TheoKit's channel seam. `handleChannelWebhook` validates the
 * signature and hands the app `payload: unknown`, stating that the `@theokit/gateway-*` package
 * translates it — see `docs/adr/0001-message-event-closed-union.md` for why the event shape is
 * fixed in core rather than extended per adapter.
 *
 * The mapping lives HERE and nowhere else. `adapter.ts` reaches for the same `buildEvent` from its
 * polling loop, so a webhook-delivered update and a polled one cannot drift into two dialects of
 * the same event — which is the failure this file exists to prevent, not merely a tidiness point.
 *
 * Everything here is pure: no transport, no credential, no clock. A caller may therefore run it on
 * a payload the adapter never saw, which is the entire point of a webhook.
 */

import type { TelegramMessageEvent } from "@theokit/gateway";

/** The `chat` fields the mapping reads — structural, so grammy's `Chat` satisfies it too. */
interface ChatLike {
  readonly id: number;
  readonly type: string;
}

/** The `message` fields the mapping reads. */
interface MessageLike {
  readonly message_id: number;
  readonly date: number;
  readonly text?: string;
  readonly caption?: string;
  readonly message_thread_id?: number;
  readonly reply_to_message?: { readonly message_id?: number };
}

/** The `from` fields the mapping reads. */
interface UserLike {
  readonly id: number;
  readonly username?: string;
  readonly first_name?: string;
}

/**
 * The single mapping, shared by the polling loop and the webhook path.
 *
 * `raw` is whatever the caller held — a grammy `Context` when polling, the update object when
 * arriving by webhook. `TelegramMessageEvent.telegram.raw` is `unknown` precisely so both fit.
 */
export function buildEvent(
  chat: ChatLike,
  msg: MessageLike,
  from: UserLike | undefined,
  raw: unknown,
): TelegramMessageEvent {
  let channelType: "dm" | "group" | "thread";
  if (chat.type === "private") {
    channelType = "dm";
  } else if (msg.message_thread_id !== undefined) {
    channelType = "thread";
  } else {
    channelType = "group";
  }

  return {
    id: `tg-${chat.id}-${msg.message_id}`,
    platform: "telegram",
    sender: {
      id: String(from?.id ?? "anonymous"),
      ...(from?.username !== undefined ? { username: from.username } : {}),
      ...(from?.first_name !== undefined ? { displayName: from.first_name } : {}),
    },
    channel: {
      id: String(chat.id),
      type: channelType,
      ...(msg.message_thread_id !== undefined ? { topicId: String(msg.message_thread_id) } : {}),
    },
    text: msg.text ?? msg.caption ?? "",
    // Telegram sends seconds; the canonical event is milliseconds.
    receivedAt: msg.date * 1000,
    ...(msg.reply_to_message?.message_id !== undefined
      ? { replyTo: String(msg.reply_to_message.message_id) }
      : {}),
    telegram: {
      chatId: chat.id,
      messageId: msg.message_id,
      ...(msg.message_thread_id !== undefined ? { threadId: msg.message_thread_id } : {}),
      raw,
    },
  };
}

/** True when `value` is a non-null, non-array object — the only shape worth reading fields off. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow the message's optional fields, dropping any that is not the type the event declares. */
function narrowMessage(msg: Record<string, unknown>, messageId: number, date: number): MessageLike {
  const threadId = msg.message_thread_id;
  const replyTo = msg.reply_to_message;

  return {
    message_id: messageId,
    date,
    ...(typeof msg.text === "string" ? { text: msg.text } : {}),
    ...(typeof msg.caption === "string" ? { caption: msg.caption } : {}),
    ...(typeof threadId === "number" && Number.isFinite(threadId)
      ? { message_thread_id: threadId }
      : {}),
    ...(isRecord(replyTo) && typeof replyTo.message_id === "number"
      ? { reply_to_message: { message_id: replyTo.message_id } }
      : {}),
  };
}

/** Narrow the sender, or drop it entirely when it carries no usable id. */
function narrowSender(value: unknown): UserLike | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== "number" || !Number.isFinite(value.id)) return undefined;

  return {
    id: value.id,
    ...(typeof value.username === "string" ? { username: value.username } : {}),
    ...(typeof value.first_name === "string" ? { first_name: value.first_name } : {}),
  };
}

/**
 * Translate one raw Telegram webhook body into a `TelegramMessageEvent`.
 *
 * Returns `null` — never throws. The caller is `onMessage`, which TheoKit invokes AFTER it has
 * already answered 200, so a throw here surfaces as an unhandled rejection in the app's request
 * path rather than as an error anyone sees.
 *
 * **`null` answers two different questions, and a caller cannot tell them apart.** That is a real
 * cost of this contract, so the ordinary half is enumerated here rather than left to be discovered:
 *
 * - **Ordinary traffic.** Telegram sends update kinds that carry no message to answer —
 *   `edited_message`, `edited_channel_post`, `callback_query`, `inline_query`,
 *   `chosen_inline_result`, `poll`, `poll_answer`, `my_chat_member`, `chat_member`,
 *   `chat_join_request`. A bot with an inline keyboard receives these constantly. An app that logs
 *   an error on every `null` will cry wolf.
 * - **A malformed body.** Not an update at all, or an update whose `message` is missing the fields
 *   the mapping requires.
 *
 * A richer return type would separate the two. It is deliberately not used: `gateway-line`'s
 * shipped translator returns a bare `undefined`, and diverging from the reference shape for a
 * distinction no consumer has asked for is the abstraction YAGNI refuses.
 *
 * @public
 */
export function parseInbound(payload: unknown): TelegramMessageEvent | null {
  if (!isRecord(payload)) return null;

  const msg = payload.message;
  if (!isRecord(msg)) return null;

  const messageId = msg.message_id;
  const date = msg.date;
  if (typeof messageId !== "number" || !Number.isFinite(messageId)) return null;
  if (typeof date !== "number" || !Number.isFinite(date)) return null;

  const chat = msg.chat;
  if (!isRecord(chat)) return null;
  if (typeof chat.id !== "number" || !Number.isFinite(chat.id)) return null;
  if (typeof chat.type !== "string") return null;

  return buildEvent(
    { id: chat.id, type: chat.type },
    narrowMessage(msg, messageId, date),
    narrowSender(msg.from),
    payload,
  );
}
