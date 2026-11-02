/**
 * Read the audio of a polled voice note (B-715, ADR D1).
 *
 * Telegram sends a voice note as a file id. The bytes take two requests: `getFile` for the file's
 * path, then a download from `https://api.telegram.org/file/bot<token>/<path>`. Only the polled
 * path holds the token, so the webhook `parseInbound` does not read voice notes.
 *
 * A failure is returned as a reason, never thrown: the caller delivers the event without audio and
 * writes the reason to stderr, so an unreadable voice leaves today's behaviour. No reason carries
 * the download URL, which contains the bot token.
 */

import type { InboundAudio } from "@theokit/gateway";
import type { Context } from "grammy";

/** The largest voice read: Bot API `getFile` serves files of at most 20 MB. */
const MAX_VOICE_BYTES = 20 * 1024 * 1024;

/** How long the download may take before it is abandoned. */
const DOWNLOAD_TIMEOUT_MS = 30_000;

const DEFAULT_MEDIA_TYPE = "audio/ogg";

/** What a read produced: the audio, or why there is none. */
type VoiceRead = { readonly audio: InboundAudio } | { readonly reason: string };

/** The `fetch` this module calls; injected in tests so nothing reaches api.telegram.org. */
type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/** The voice object of the message, as far as this module reads it. */
interface VoiceFields {
  readonly duration?: unknown;
  readonly mime_type?: unknown;
  readonly file_size?: unknown;
}

/**
 * Read the voice note of `ctx.message`. The caller calls this only when the message has a `voice`.
 */
export async function readVoice(
  ctx: Context,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<VoiceRead> {
  const voice = (ctx.message?.voice ?? {}) as VoiceFields;
  if (typeof voice.file_size === "number" && voice.file_size > MAX_VOICE_BYTES) {
    return { reason: "too_large" };
  }
  const path = await filePath(ctx);
  if (typeof path !== "string") return path;
  const bytes = await download(`https://api.telegram.org/file/bot${token}/${path}`, fetchImpl);
  if (!(bytes instanceof Uint8Array)) return bytes;
  return {
    audio: {
      data: bytes,
      mediaType: (voice.mime_type as string | undefined) ?? DEFAULT_MEDIA_TYPE,
      durationSeconds: voice.duration as number,
    },
  };
}

/** The file's path on Telegram's file server, or the reason it is not known. */
async function filePath(ctx: Context): Promise<string | { reason: string }> {
  let file: { file_path?: string };
  try {
    file = await ctx.getFile();
  } catch {
    return { reason: "get_file_failed" };
  }
  return file.file_path ?? { reason: "no_file_path" };
}

/** The downloaded bytes, or the reason the download failed. */
async function download(
  url: string,
  fetchImpl: FetchLike,
): Promise<Uint8Array | { reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: controller.signal });
  } catch {
    return { reason: controller.signal.aborted ? "timeout" : "download_failed" };
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) return { reason: `download_status_${response.status}` };
  return readBounded(response.body as ReadableStream<Uint8Array>);
}

/** The whole body, or `too_large` as soon as it passes the bound. */
async function readBounded(
  body: ReadableStream<Uint8Array>,
): Promise<Uint8Array | { reason: string }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_VOICE_BYTES) {
      await reader.cancel();
      return { reason: "too_large" };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
