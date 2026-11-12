/**
 * QQ Bot webhook signatures: Ed25519, with a key pair derived from the bot secret.
 *
 * The seed is the secret repeated until it is 32 bytes. A callback carries the hex signature of
 * `timestamp + rawBody`; the URL-validation event (`op` 13) asks for the signature of
 * `event_ts + plain_token`.
 */

import crypto from "node:crypto";

/** How far a callback timestamp may be from now, in seconds. */
export const QQ_TOLERANCE_S = 300;

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function privateKeyOf(secret: string): crypto.KeyObject {
  let seed = secret;
  while (seed.length < 32) seed += secret;
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seed.slice(0, 32), "utf8")]);
  return crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

/** The hex Ed25519 signature of `message` under the key derived from `secret`. */
export function signQQ(secret: string, message: string): string {
  return crypto.sign(null, Buffer.from(message, "utf8"), privateKeyOf(secret)).toString("hex");
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
  if (!Number.isFinite(seconds) || Math.abs(nowMs / 1000 - seconds) > QQ_TOLERANCE_S) {
    return false;
  }
  try {
    const publicKey = crypto.createPublicKey(privateKeyOf(secret));
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
