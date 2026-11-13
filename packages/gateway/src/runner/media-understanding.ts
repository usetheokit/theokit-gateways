/**
 * `withMediaUnderstanding`: folds a voice note's transcript (and, once events carry them, an
 * image's description) into the turn text. The gateway makes no model or network call; the
 * caller supplies the functions.
 */
import type { MessageEvent as GatewayMessageEvent } from "../types/message-event.js";
import type { GatewayHandler } from "./gateway-runner.js";

export interface MediaUnderstandingOptions {
  /** e.g. plugin-voice's transcribe, bound to its config. */
  transcribe?(audio: { data: Uint8Array; mediaType: string }): Promise<string>;
  /** Called for each image an event carries, once inbound images exist. */
  describeImage?(image: { data: Uint8Array; mediaType: string }): Promise<string>;
  /** Largest payload sent to a function. Default 20 MiB; larger is reported as not understood. */
  readonly maxBytes?: number;
  /** Where a failure is reported, with the media type and the error name only. */
  readonly write?: (line: string) => void;
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

function sanitizeType(mediaType: string): string {
  return mediaType.replace(/[^\w/.+-]/g, "");
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

/** Wraps a handler: the event it receives has the transcript or description appended to text. */
export function withMediaUnderstanding(
  handler: GatewayHandler,
  options: MediaUnderstandingOptions,
): GatewayHandler {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const write = options.write ?? ((line: string) => void process.stderr.write(`${line}\n`));

  const understand = async (
    kind: "Audio transcript" | "Image description",
    media: { data: Uint8Array; mediaType: string },
    fn: ((m: { data: Uint8Array; mediaType: string }) => Promise<string>) | undefined,
  ): Promise<string> => {
    const type = sanitizeType(media.mediaType);
    if (fn === undefined) return `[Attachment of type ${type} not understood]`;
    const failed = `[Attachment of type ${type} could not be understood]`;
    if (media.data.byteLength > maxBytes) {
      report(type, "TooLarge");
      return failed;
    }
    try {
      const text = await fn({ data: media.data, mediaType: media.mediaType });
      return `[${kind}: ${text}]`;
    } catch (error) {
      report(type, errorName(error));
      return failed;
    }
  };

  const report = (type: string, name: string): void => {
    try {
      write(`[gateway] media understanding failed for ${type}: ${name}`);
    } catch {
      // a failing sink never fails the turn
    }
  };

  return async (event, ctx) => {
    const lines: string[] = [];
    if (event.audio !== undefined) {
      lines.push(
        await understand("Audio transcript", event.audio, options.transcribe?.bind(options)),
      );
    }
    if (lines.length === 0) return handler(event, ctx);
    const text = [event.text, ...lines].filter((part) => part !== "").join("\n");
    const wrapped: GatewayMessageEvent = { ...event, text };
    return handler(wrapped, ctx);
  };
}
