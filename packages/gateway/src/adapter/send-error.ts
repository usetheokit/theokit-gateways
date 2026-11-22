import type { SendResult } from "./base.js";

function parseRetryAfter(value: string | null | undefined, now: number): number | undefined {
  if (value == null) return undefined;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  // An HTTP date always has letters; this rejects "-1" and other numeric oddities.
  if (!/[A-Za-z]/.test(v)) return undefined;
  const at = Date.parse(v);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

const STATUS_CODES: Readonly<Record<number, string>> = {
  429: "rate_limit",
  401: "auth_failed",
  403: "permission_denied",
  408: "timeout",
};

function codeForStatus(status: number): string {
  return STATUS_CODES[status] ?? (status >= 500 ? "server_error" : "platform_error");
}

/**
 * Map an HTTP status to a failed SendResult: 429 -> rate_limit (retryAfterMs from a Retry-After
 * value in seconds or an HTTP date), 401 -> auth_failed, 403 -> permission_denied,
 * 408 -> timeout, 5xx -> server_error, other -> platform_error.
 */
export function sendErrorFromHttp(
  status: number,
  message: string,
  options?: { retryAfter?: string | null; platformCode?: string; now?: () => number },
): SendResult {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new RangeError(`status must be an integer in 100..599, got ${String(status)}`);
  }
  const code = codeForStatus(status);
  const retryAfterMs =
    status === 429 ? parseRetryAfter(options?.retryAfter, (options?.now ?? Date.now)()) : undefined;
  return {
    ok: false,
    error: {
      code,
      message,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      ...(options?.platformCode !== undefined ? { platformCode: options.platformCode } : {}),
    },
  };
}
