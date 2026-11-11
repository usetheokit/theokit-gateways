/**
 * Zalo OA webhook signature: header `X-ZEvent-Signature: mac=<hex>` where
 * `hex = sha256(appId + rawBody + timestamp + oaSecretKey)`, `timestamp` being the event's own
 * `timestamp` field. Compared in constant time against the RAW body.
 */

import crypto from "node:crypto";

export function computeZaloSignature(
  appId: string,
  rawBody: string,
  timestamp: string,
  oaSecretKey: string,
): string {
  return crypto
    .createHash("sha256")
    .update(appId + rawBody + timestamp + oaSecretKey, "utf8")
    .digest("hex");
}

/** `false`, never a throw, for a missing, malformed or mismatched signature. */
export function verifyZaloSignature(
  opts: { appId: string; oaSecretKey: string },
  rawBody: string,
  header: string | undefined,
): boolean {
  if (header === undefined || header.length === 0) return false;
  let timestamp: string;
  try {
    const parsed = JSON.parse(rawBody) as { timestamp?: unknown };
    if (typeof parsed.timestamp !== "string" && typeof parsed.timestamp !== "number") return false;
    timestamp = String(parsed.timestamp);
  } catch {
    return false;
  }
  const expected = Buffer.from(
    `mac=${computeZaloSignature(opts.appId, rawBody, timestamp, opts.oaSecretKey)}`,
  );
  const given = Buffer.from(header);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
