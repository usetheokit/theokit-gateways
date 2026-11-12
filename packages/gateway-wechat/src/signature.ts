/**
 * WeChat server-URL signature: `signature = sha1(sort([token, timestamp, nonce]).join(""))`, sent
 * as query parameters on both the verification GET and every message POST. Compared in constant
 * time.
 *
 * In plain mode the signature covers the token, timestamp and nonce only, never the body, so a
 * signed query string is accepted only while its timestamp is fresh: a timestamp further than
 * `WECHAT_TOLERANCE_S` from now is refused here, and the adapter refuses a nonce it has already
 * accepted with another body.
 */

import crypto from "node:crypto";

/** How far a webhook timestamp may be from now, in seconds. */
export const WECHAT_TOLERANCE_S = 300;

/** Byte-order comparison, as the platform spec sorts (not locale-aware). */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The hex SHA-1 signature WeChat sends for `token`, `timestamp` and `nonce`. */
export function computeWeChatSignature(token: string, timestamp: string, nonce: string): string {
  // SHA-1 is mandated by the platform callback protocol; Sonar reports it on the `return` line.
  return crypto // NOSONAR
    .createHash("sha1")
    .update([token, timestamp, nonce].sort(byCodeUnit).join(""), "utf8")
    .digest("hex");
}

/** Whether `timestamp` is whole Unix seconds within `WECHAT_TOLERANCE_S` of `nowMs`. */
export function isWeChatTimestampFresh(timestamp: string, nowMs: number = Date.now()): boolean {
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  return Math.abs(nowMs / 1000 - Number(timestamp)) <= WECHAT_TOLERANCE_S;
}

/** `false`, never a throw, for a missing, stale, malformed or mismatched signature. */
export function verifyWeChatSignature(
  token: string,
  query: { signature?: string; timestamp?: string; nonce?: string },
  nowMs: number = Date.now(),
): boolean {
  const { signature, timestamp, nonce } = query;
  if (!signature || !timestamp || !nonce) return false;
  if (!isWeChatTimestampFresh(timestamp, nowMs)) return false;
  const expected = Buffer.from(computeWeChatSignature(token, timestamp, nonce));
  const given = Buffer.from(signature);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
