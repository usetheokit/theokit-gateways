/**
 * Yuanbao callback signature: hex `HMAC-SHA256(callbackSecret, timestamp + "." + rawBody)`.
 */

import crypto from "node:crypto";

/** How far a callback timestamp may be from now, in seconds. */
export const YUANBAO_TOLERANCE_S = 300;

/** The hex signature a callback carries for `timestamp` and `rawBody`. */
export function computeYuanbaoSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
}

/** `false`, never a throw, for a missing, stale, malformed or mismatched signature. */
export function verifyYuanbaoSignature(
  secret: string,
  rawBody: string,
  signature: string | undefined,
  timestamp: string | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!signature || !timestamp) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(nowMs / 1000 - seconds) > YUANBAO_TOLERANCE_S) {
    return false;
  }
  const expected = Buffer.from(computeYuanbaoSignature(secret, timestamp, rawBody));
  const given = Buffer.from(signature);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
