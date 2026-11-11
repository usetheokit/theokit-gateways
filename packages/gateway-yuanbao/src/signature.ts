/**
 * Yuanbao webhook signature: `signature = hex(HMAC-SHA256(appSecret, timestamp + nonce + rawBody))`,
 * sent in the `timestamp`, `nonce` and `signature` request fields. Compared in constant time.
 */

import crypto from "node:crypto";

export function computeYuanbaoSignature(
  appSecret: string,
  timestamp: string,
  nonce: string,
  rawBody: string,
): string {
  return crypto
    .createHmac("sha256", appSecret)
    .update(timestamp + nonce + rawBody, "utf8")
    .digest("hex");
}

/** `false`, never a throw, for a missing, malformed or mismatched signature. */
export function verifyYuanbaoSignature(
  appSecret: string,
  query: { signature?: string; timestamp?: string; nonce?: string },
  rawBody: string,
): boolean {
  const { signature, timestamp, nonce } = query;
  if (!signature || !timestamp || !nonce) return false;
  const expected = Buffer.from(computeYuanbaoSignature(appSecret, timestamp, nonce, rawBody));
  const given = Buffer.from(signature);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
