/**
 * `im.message.receive_v1` → `FeishuLarkMessageEvent`.
 *
 * The SDK's dispatcher flattens the event's `header` and `event` into one object, so `event_id`
 * sits beside `sender` and `message`.
 */

import type { FeishuLarkMessageEvent } from "@theokit/gateway";

/** What one dispatched event becomes. */
export type NormalizeResult =
  | { readonly kind: "event"; readonly event: FeishuLarkMessageEvent }
  /** Not a message for the bot: an app's own message, or one that is not text. */
  | { readonly kind: "skip" }
  /** A message the adapter cannot read, with the reason to log. */
  | { readonly kind: "invalid"; readonly reason: string };

interface LarkMessage {
  readonly message_id?: unknown;
  readonly chat_id?: unknown;
  readonly chat_type?: unknown;
  readonly message_type?: unknown;
  readonly content?: unknown;
}

interface LarkReceive {
  readonly event_id?: unknown;
  readonly sender?: { readonly sender_type?: unknown; readonly sender_id?: { open_id?: unknown } };
  readonly message?: LarkMessage;
}

/**
 * Read one dispatched event.
 *
 * @param data what the SDK's dispatcher handed over
 * @param receivedAt the receipt time, ms since epoch
 */
export function normalizeLarkMessage(data: unknown, receivedAt: number): NormalizeResult {
  const receive = (typeof data === "object" && data !== null ? data : {}) as LarkReceive;
  const message = receive.message;
  const messageId = message?.message_id;
  const chatId = message?.chat_id;
  if (typeof messageId !== "string" || typeof chatId !== "string") {
    return { kind: "invalid", reason: "event has no message id or chat id" };
  }
  if (receive.sender?.sender_type === "app" || message?.message_type !== "text") {
    return { kind: "skip" };
  }
  const text = textOf(message.content);
  if (text === undefined) {
    return { kind: "invalid", reason: `message ${messageId} has content that is not JSON` };
  }
  const openId = receive.sender?.sender_id?.open_id;
  const sender = typeof openId === "string" ? openId : "";
  return {
    kind: "event",
    event: {
      id: messageId,
      platform: "feishu_lark",
      sender: { id: sender },
      channel: { id: chatId, type: message.chat_type === "p2p" ? "dm" : "group" },
      text,
      receivedAt,
      feishu_lark: {
        chatId,
        messageId,
        openId: sender,
        eventId: typeof receive.event_id === "string" ? receive.event_id : messageId,
        raw: data,
      },
    },
  };
}

/** The `text` of a text message's JSON `content`, or `undefined` when it is not JSON. */
function textOf(content: unknown): string | undefined {
  if (typeof content !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(content);
    const text = (parsed as { text?: unknown } | null)?.text;
    return typeof text === "string" ? text : "";
  } catch {
    // Reported to the caller as `invalid`, which logs it; the dispatcher must never see a throw.
    return undefined;
  }
}
