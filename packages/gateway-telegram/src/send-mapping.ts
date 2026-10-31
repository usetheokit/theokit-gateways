/**
 * How a Telegram send maps the gateway's options and failures onto grammy's (B-674).
 *
 * Shared by `TelegramAdapter` and the photo path in `send-photos.ts`, which both send through the
 * Bot API and must answer a declared format and a thrown error the same way.
 */

import type { OutboundMessage, SendResult } from "@theokit/gateway";
import { GrammyError, HttpError } from "grammy";

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
