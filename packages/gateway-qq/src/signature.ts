/**
 * QQ Bot callback signature: Ed25519 over `timestamp + rawBody`, headers `X-Signature-Ed25519`
 * (hex) and `X-Signature-Timestamp`. The key pair is derived from the bot's AppSecret: the secret
 * repeated until it is 32 bytes is the private seed.
 */

import crypto from "node:crypto";

/** PKCS#8 prefix of an Ed25519 private key; the 32-byte seed follows. */
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** How far a callback timestamp may be from now, in seconds. */
export const QQ_TOLERANCE_S = 300;

function privateKeyFor(secret: string): crypto.KeyObject {
  let seed = secret;
  while (seed.length < 32) seed += seed;
  return crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed.slice(0, 32), "utf8")]),
    format: "der",
    type: "pkcs8",
  });
}

/** The hex Ed25519 signature of `message` under the key derived from `secret`. */
export function signQQ(secret: string, message: string): string {
  return crypto.sign(null, Buffer.from(message, "utf8"), privateKeyFor(secret)).toString("hex");
}

/** `false`, never a throw, for a missing, stale, malformed or mismatched signature. */
export function verifyQQSignature(
  secret: string,
  rawBody: string,
  signature: string | undefined,
  timestamp: string | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!signature || !timestamp || !/^[0-9a-f]+$/i.test(signature)) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(nowMs / 1000 - seconds) > QQ_TOLERANCE_S) return false;
  try {
    const publicKey = crypto.createPublicKey(privateKeyFor(secret));
    return crypto.verify(
      null,
      Buffer.from(timestamp + rawBody, "utf8"),
      publicKey,
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}
