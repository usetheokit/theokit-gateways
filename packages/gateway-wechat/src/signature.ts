/**
 * WeChat server-URL signature: `signature = sha1(sort([token, timestamp, nonce]).join(""))`, sent
 * as query parameters on both the verification GET and every message POST. Compared in constant
 * time.
 */

import crypto from "node:crypto";

export function computeWeChatSignature(token: string, timestamp: string, nonce: string): string {
  return crypto
    .createHash("sha1")
    .update([token, timestamp, nonce].sort().join(""), "utf8")
    .digest("hex");
}

/** `false`, never a throw, for a missing, malformed or mismatched signature. */
export function verifyWeChatSignature(
  token: string,
  query: { signature?: string; timestamp?: string; nonce?: string },
): boolean {
  const { signature, timestamp, nonce } = query;
  if (!signature || !timestamp || !nonce) return false;
  const expected = Buffer.from(computeWeChatSignature(token, timestamp, nonce));
  const given = Buffer.from(signature);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
