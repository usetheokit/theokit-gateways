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

/** How long the whole read, `getFile` and download, may take before it is abandoned. */
const READ_TIMEOUT_MS = 30_000;

const DEFAULT_MEDIA_TYPE = "audio/ogg";

/** What a read produced: the audio, or why there is none. */
type VoiceRead = { readonly audio: InboundAudio } | { readonly reason: string };

/** The `fetch` this module calls; injected in tests so nothing reaches api.telegram.org. */
type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/**
 * The voice object of the message, as far as this module reads it. Every field is `unknown`: a
 * hand-built update or a change on Telegram's side may send any of them in another shape (EC-2).
 */
interface VoiceFields {
  readonly file_id?: unknown;
  readonly duration?: unknown;
  readonly mime_type?: unknown;
  readonly file_size?: unknown;
}

/** A failure, named by the reason the caller writes to stderr. */
type Failure = { readonly reason: string };

/**
 * Read the voice note of `ctx.message`. The caller calls this only when the message has a `voice`.
 */
export async function readVoice(
  ctx: Context,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<VoiceRead> {
  const voice = (ctx.message?.voice ?? {}) as VoiceFields;
  if (typeof voice.file_id !== "string") return { reason: "no_file_id" };
  if (typeof voice.file_size === "number" && voice.file_size > MAX_VOICE_BYTES) {
    return { reason: "too_large" };
  }
  // One deadline over both requests: a stalled getFile holds the polling handler, and every
  // later update, as surely as a stalled download (NFR-006).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  try {
    const path = await filePath(ctx, controller.signal);
    if (typeof path !== "string") return path;
    const url = `https://api.telegram.org/file/bot${token}/${path}`;
    const bytes = await download(url, fetchImpl, controller.signal);
    if (!(bytes instanceof Uint8Array)) return bytes;
    return { audio: { data: bytes, ...voiceDetails(voice) } };
  } finally {
    clearTimeout(timer);
  }
}

/** The media type and duration, each replaced by its default when it is not of its type. */
function voiceDetails(voice: VoiceFields): { mediaType: string; durationSeconds: number } {
  const duration = voice.duration;
  return {
    mediaType: typeof voice.mime_type === "string" ? voice.mime_type : DEFAULT_MEDIA_TYPE,
    durationSeconds: typeof duration === "number" && Number.isFinite(duration) ? duration : 0,
  };
}

/** The file's path on Telegram's file server, or the reason it is not known. */
async function filePath(ctx: Context, signal: AbortSignal): Promise<string | Failure> {
  let file: { file_path?: string };
  try {
    // grammy types the signal with the abort-controller polyfill; a native one is what it reads.
    file = await ctx.getFile(signal as Parameters<Context["getFile"]>[0]);
  } catch {
    return { reason: signal.aborted ? "timeout" : "get_file_failed" };
  }
  return file.file_path ?? { reason: "no_file_path" };
}

/**
 * The downloaded bytes, or the reason the download failed.
 *
 * `signal` covers the body read too, not only the headers: a body that stalls after the headers
 * would otherwise hold the polling handler, and every later update, for good (EC-1).
 */
async function download(
  url: string,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<Uint8Array | Failure> {
  try {
    const response = await fetchImpl(url, { signal });
    if (!response.ok) return { reason: `download_status_${response.status}` };
    if (response.body === null) return { reason: "download_failed" };
    return await readBounded(response.body, signal);
  } catch {
    return { reason: signal.aborted ? "timeout" : "download_failed" };
  }
}

/** The whole body, `too_large` as soon as it passes the bound, or `timeout` when `signal` aborts. */
async function readBounded(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<Uint8Array | Failure> {
  const reader = body.getReader();
  const cancel = (): void => void reader.cancel().catch(() => undefined);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const chunks = await readChunks(reader);
    if (signal.aborted) return { reason: "timeout" };
    return chunks ?? { reason: "too_large" };
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

/** The chunks joined into one array, or `undefined` once more than the bound has arrived. */
async function readChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Uint8Array | undefined> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_VOICE_BYTES) {
      await reader.cancel();
      return undefined;
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
