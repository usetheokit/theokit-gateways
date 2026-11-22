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
  let code: string;
  if (status === 429) code = "rate_limit";
  else if (status === 401) code = "auth_failed";
  else if (status === 403) code = "permission_denied";
  else if (status === 408) code = "timeout";
  else if (status >= 500) code = "server_error";
  else code = "platform_error";
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
