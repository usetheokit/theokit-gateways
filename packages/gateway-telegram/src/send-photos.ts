/**
 * The photo path of `TelegramAdapter.sendMessage`: one `sendPhoto` per image (B-674, ADR D2).
 *
 * The text rides as the first photo's caption when it is 1 to 1024 UTF-16 units. A longer text
 * gets no caption and follows the last photo through the same split as a text send, so nothing of
 * it is cut. Every attachment is checked before the first request, so a refusal makes no call.
 *
 * The module also holds how a send maps a declared format and a thrown grammy error, which
 * `TelegramAdapter` imports from here: both paths must answer them the same way, and keeping them
 * here rather than in `adapter.ts` avoids an import cycle.
 */

import type { OutboundAttachment, OutboundMessage, SendResult } from "@theokit/gateway";
import { type Api, GrammyError, HttpError, InputFile } from "grammy";
import { splitForTelegram } from "./split.js";

/** Telegram's limit on a photo caption, in UTF-16 units (Bot API `sendPhoto`). */
const CAPTION_LIMIT = 1024;

/** Options every request of one send shares: the parse mode and the forum topic. */
interface SharedOptions {
  parse_mode?: "Markdown" | "HTML";
  message_thread_id?: number;
}

/**
 * Whether an outbound carries attachments to send. `!== 0`, not `> 0`: a non-array value has no
 * numeric length and is taken down the photo path, where it is refused rather than dropped (EC-1).
 */
export function hasAttachments(out: OutboundMessage): boolean {
  return out.attachments !== undefined && out.attachments.length !== 0;
}

/**
 * Send the images of `out` as photos, then the text when it is too long for a caption.
 *
 * Returns the id of the last message sent. A failure on photo k returns the mapped error at once,
 * and photos 1 to k-1 stay delivered: Telegram has no way to take them back as one unit.
 */
export async function sendPhotos(api: Api, out: OutboundMessage): Promise<SendResult> {
  const chatId = Number(out.channel.id);
  if (Number.isNaN(chatId)) {
    return {
      ok: false,
      error: { code: "invalid_channel", message: `channel.id "${out.channel.id}" not numeric` },
    };
  }
  const refusal = validatePhotos(out.attachments);
  if (refusal !== undefined) return refusal;
  const shared = sharedOptions(out);
  try {
    let lastId = await sendEachPhoto(api, chatId, out, shared);
    if (out.text.length > CAPTION_LIMIT) {
      for (const chunk of splitForTelegram(out.text)) {
        lastId = (await api.sendMessage(chatId, chunk, shared)).message_id;
      }
    }
    return { ok: true, messageId: String(lastId) };
  } catch (err) {
    return mapSendError(err);
  }
}

/** One `sendPhoto` per image, in order; the caption and reply target go on the first only. */
async function sendEachPhoto(
  api: Api,
  chatId: number,
  out: OutboundMessage,
  shared: SharedOptions,
): Promise<number> {
  const images = out.attachments as ReadonlyArray<OutboundAttachment>;
  const caption = captionOf(out.text);
  let lastId = 0;
  for (const [index, attachment] of images.entries()) {
    const first = index === 0 ? firstPhotoOptions(out, caption) : {};
    const file = new InputFile(attachment.data, attachment.filename);
    const msg = await api.sendPhoto(chatId, file, { ...shared, ...first });
    lastId = msg.message_id;
  }
  return lastId;
}

/** The text as a caption when it fits in 1 to 1024 units, otherwise none. */
function captionOf(text: string): string | undefined {
  return text.length >= 1 && text.length <= CAPTION_LIMIT ? text : undefined;
}

/** What only the first photo carries: the caption and the message it replies to. */
function firstPhotoOptions(
  out: OutboundMessage,
  caption: string | undefined,
): { caption?: string; reply_parameters?: { message_id: number } } {
  return {
    ...(caption !== undefined ? { caption } : {}),
    ...(out.replyTo !== undefined ? { reply_parameters: { message_id: Number(out.replyTo) } } : {}),
  };
}

/** The parse mode and the forum topic, applied to every request of the send. */
function sharedOptions(out: OutboundMessage): SharedOptions {
  const parseMode = mapFormat(out.format);
  const threadId = out.channel.topicId !== undefined ? Number(out.channel.topicId) : undefined;
  return {
    ...(parseMode !== undefined ? { parse_mode: parseMode } : {}),
    ...(threadId !== undefined ? { message_thread_id: threadId } : {}),
  };
}

/**
 * The refusal for an attachment list Telegram cannot send as photos, or `undefined`.
 *
 * Not an array, or an image with no bytes: `invalid_attachment`. A kind other than `image`:
 * `attachments_unsupported`, the code every adapter answers for what it cannot attach.
 */
function validatePhotos(attachments: unknown): SendResult | undefined {
  if (!Array.isArray(attachments)) {
    return refuse("invalid_attachment", "attachments is not a list");
  }
  for (const attachment of attachments as ReadonlyArray<OutboundAttachment | null>) {
    if (typeof attachment !== "object" || attachment === null) {
      return refuse("invalid_attachment", "an attachment is not an object");
    }
    if (attachment.kind !== "image") {
      return refuse("attachments_unsupported", "telegram adapter sends only image attachments");
    }
    if (!(attachment.data instanceof Uint8Array) || attachment.data.length === 0) {
      return refuse("invalid_attachment", "an image attachment has no bytes");
    }
  }
  return undefined;
}

function refuse(code: string, message: string): SendResult {
  return { ok: false, error: { code, message } };
}

/** The `parse_mode` grammy takes for a declared format, or `undefined` for plain text. */
export function mapFormat(
  format: "plain" | "markdown" | "html" | undefined,
): "Markdown" | "HTML" | undefined {
  if (format === "markdown") return "Markdown";
  if (format === "html") return "HTML";
  return undefined;
}

/** The `parse_mode` option for a declared format, or no option. */
export function parseModeOptions(format: OutboundMessage["format"]): {
  parse_mode?: "Markdown" | "HTML";
} {
  const parseMode = mapFormat(format);
  return parseMode !== undefined ? { parse_mode: parseMode } : {};
}

/** A thrown grammy error as a `SendResult`; never rethrows. */
export function mapSendError(err: unknown): SendResult {
  if (err instanceof GrammyError) {
    const description = err.description.toLowerCase();
    if (description.includes("rate limit") || err.error_code === 429) {
      return { ok: false, error: { code: "rate_limited", message: err.description } };
    }
    if (description.includes("forbidden") || err.error_code === 403) {
      return { ok: false, error: { code: "no_permission", message: err.description } };
    }
    if (description.includes("parse")) {
      return { ok: false, error: { code: "markdown_error", message: err.description } };
    }
    return {
      ok: false,
      error: { code: `telegram_${err.error_code}`, message: err.description },
    };
  }
  if (err instanceof HttpError) {
    return { ok: false, error: { code: "network_error", message: err.message } };
  }
  return { ok: false, error: { code: "unknown", message: (err as Error).message } };
}
