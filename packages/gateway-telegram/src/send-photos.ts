/**
 * The attachment path of `TelegramAdapter.sendMessage`: one `sendPhoto` per image (B-674) and one
 * `sendVoice` per audio clip (B-715, ADR D2). The module keeps its photo name: one path for both
 * kinds means one caption rule, and a module of its own for voice would import the caption helpers
 * from here while this one imports it, a cycle.
 *
 * The text rides as the first attachment's caption when it is 1 to 1024 UTF-16 units. A longer text
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

/** Telegram's limit on an uploaded photo: "The photo must be at most 10 MB" (Bot API `sendPhoto`). */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Telegram's limit on a file a bot uploads, voice included: 50 MB (Bot API "Sending files"). */
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

/** The bound on each kind's bytes, and the word a refusal uses for it. */
const KIND_LIMITS = {
  image: { maxBytes: MAX_PHOTO_BYTES, label: "an image", bound: "10 MiB" },
  audio: { maxBytes: MAX_AUDIO_BYTES, label: "an audio", bound: "50 MiB" },
} as const;

/**
 * The most images one send takes. Each image is a request, and a group chat takes about 20
 * messages a minute before Telegram answers 429; ten, the size of a `sendMediaGroup` album, leaves
 * room for the text that follows. A longer list is refused whole rather than cut off part way.
 */
const MAX_PHOTOS_PER_SEND = 10;

/** Options every request of one send shares: the parse mode and the forum topic. */
interface SharedOptions {
  parse_mode?: "Markdown" | "HTML";
  message_thread_id?: number;
}

/**
 * Whether an outbound carries attachments to send. Absent, `null` and an empty list do not. `!== 0`,
 * not `> 0`: any other non-array value has no numeric length and is taken down the photo path,
 * where it is refused rather than dropped (EC-1).
 */
export function hasAttachments(out: OutboundMessage): boolean {
  return out.attachments != null && out.attachments.length !== 0;
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
  const refusal = validateAttachments(out.attachments);
  if (refusal !== undefined) return refusal;
  const shared = sharedOptions(out);
  try {
    let lastId = await sendEachAttachment(api, chatId, out, shared);
    if (out.text.length > CAPTION_LIMIT) {
      for (const chunk of splitForTelegram(out.text)) {
        lastId = (await withPlainFallback(shared, (opts) => api.sendMessage(chatId, chunk, opts)))
          .message_id;
      }
    }
    return { ok: true, messageId: String(lastId) };
  } catch (err) {
    return mapSendError(err);
  }
}

/**
 * One `sendPhoto` per image and one `sendVoice` per audio clip, in order; the caption and reply
 * target go on the first only, whatever its kind.
 */
async function sendEachAttachment(
  api: Api,
  chatId: number,
  out: OutboundMessage,
  shared: SharedOptions,
): Promise<number> {
  const attachments = out.attachments as ReadonlyArray<OutboundAttachment>;
  const caption = captionOf(out.text);
  let lastId = 0;
  for (const [index, attachment] of attachments.entries()) {
    const options = { ...shared, ...(index === 0 ? firstPhotoOptions(out, caption) : {}) };
    const msg = await withPlainFallback<typeof options, { message_id: number }>(options, (opts) => {
      const file = new InputFile(attachment.data, attachment.filename);
      return attachment.kind === "audio"
        ? api.sendVoice(chatId, file, opts)
        : api.sendPhoto(chatId, file, opts);
    });
    lastId = msg.message_id;
  }
  return lastId;
}

/**
 * Run `send` with `options`. When Telegram refuses the legacy Markdown (`markdown_error`), write
 * one diagnostic line and run `send` once more without `parse_mode`. Any other failure, and a
 * failure of the resend, is rethrown for the caller's `mapSendError`.
 */
export async function withPlainFallback<O extends { parse_mode?: "Markdown" | "HTML" }, R>(
  options: O,
  send: (options: O) => Promise<R>,
): Promise<R> {
  try {
    return await send(options);
  } catch (err) {
    if (options.parse_mode === undefined) throw err;
    const mapped = mapSendError(err);
    if (mapped.ok || mapped.error?.code !== "markdown_error") throw err;
    process.stderr.write(
      `[theokit-gateway-telegram] ${mapped.error.message}; resending as plain text\n`,
    );
    const { parse_mode: _dropped, ...plain } = options;
    return send(plain as O);
  }
}

/** The text as a caption when it fits in 1 to 1024 units, otherwise none. */
function captionOf(text: string): string | undefined {
  return text.length >= 1 && text.length <= CAPTION_LIMIT ? text : undefined;
}

/** What only the first attachment carries: the caption and the message it replies to. */
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
 * The refusal for an attachment list Telegram cannot send, or `undefined`.
 *
 * Not an array, more than ten attachments, an entry with no bytes or over its kind's bound (10 MiB
 * for an image, 50 MiB for audio), or audio whose media type is not `audio/*`:
 * `invalid_attachment`. A kind other than `image` or `audio`: `attachments_unsupported`, the code
 * every adapter answers for what it cannot attach. Every entry is checked before the first request,
 * so a refusal makes no call and never leaves part of the list delivered.
 */
function validateAttachments(attachments: unknown): SendResult | undefined {
  if (!Array.isArray(attachments)) {
    return refuse("invalid_attachment", "attachments is not a list");
  }
  if (attachments.length > MAX_PHOTOS_PER_SEND) {
    return refuse(
      "invalid_attachment",
      `telegram adapter sends at most ${MAX_PHOTOS_PER_SEND} attachments at once, got ${attachments.length}`,
    );
  }
  for (const attachment of attachments as ReadonlyArray<OutboundAttachment | null>) {
    const refusal = validateAttachment(attachment);
    if (refusal !== undefined) return refusal;
  }
  return undefined;
}

/** The refusal for one entry of the list, or `undefined` when Telegram can send it. */
function validateAttachment(attachment: OutboundAttachment | null): SendResult | undefined {
  if (typeof attachment !== "object" || attachment === null) {
    return refuse("invalid_attachment", "an attachment is not an object");
  }
  if (attachment.kind !== "image" && attachment.kind !== "audio") {
    return refuse(
      "attachments_unsupported",
      "telegram adapter sends only image and audio attachments",
    );
  }
  const limit = KIND_LIMITS[attachment.kind];
  if (!(attachment.data instanceof Uint8Array) || attachment.data.length === 0) {
    return refuse("invalid_attachment", `${limit.label} attachment has no bytes`);
  }
  if (attachment.data.length > limit.maxBytes) {
    return refuse(
      "invalid_attachment",
      `${limit.label} attachment is ${attachment.data.length} bytes; Telegram takes at most ${limit.bound}`,
    );
  }
  return mediaTypeRefusal(attachment);
}

/** Audio must declare an `audio/*` media type, in any case; an image's is not checked (B-674). */
function mediaTypeRefusal(attachment: OutboundAttachment): SendResult | undefined {
  if (attachment.kind !== "audio") return undefined;
  const mediaType = typeof attachment.mediaType === "string" ? attachment.mediaType : "";
  if (mediaType.toLowerCase().startsWith("audio/")) return undefined;
  return refuse("invalid_attachment", `an audio attachment has media type "${mediaType}"`);
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

function mapGrammyError(err: GrammyError): SendResult {
  // A proxy or a non Bot API body can leave `description` undefined.
  const message = err.description ?? err.message;
  const description = message.toLowerCase();
  if (description.includes("rate limit") || err.error_code === 429) {
    return { ok: false, error: { code: "rate_limited", message } };
  }
  if (description.includes("forbidden") || err.error_code === 403) {
    return { ok: false, error: { code: "no_permission", message } };
  }
  if (description.includes("parse")) {
    return { ok: false, error: { code: "markdown_error", message } };
  }
  return { ok: false, error: { code: `telegram_${err.error_code ?? "unknown"}`, message } };
}

/** A thrown grammy error as a `SendResult`; never rethrows. */
export function mapSendError(err: unknown): SendResult {
  if (err instanceof GrammyError) return mapGrammyError(err);
  if (err instanceof HttpError) {
    return { ok: false, error: { code: "network_error", message: err.message } };
  }
  return { ok: false, error: { code: "unknown", message: (err as Error).message } };
}
