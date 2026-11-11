/**
 * WeCom callback crypto: the request signature and the AES-256-CBC envelope.
 *
 * `msg_signature = sha1(sort([token, timestamp, nonce, encrypted]).join(""))`. The envelope is
 * AES-256-CBC with the key `base64(EncodingAESKey + "=")`, IV the key's first 16 bytes, PKCS#7
 * padding to a 32-byte block, and the plaintext laid out as 16 random bytes, a 4-byte big-endian
 * message length, the message, then the receiving corp id.
 */

import crypto from "node:crypto";

export function computeWeComSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypted: string,
): string {
  return crypto
    .createHash("sha1")
    .update([token, timestamp, nonce, encrypted].sort().join(""), "utf8")
    .digest("hex");
}

/** `false`, never a throw, for a missing, malformed or mismatched signature. */
export function verifyWeComSignature(
  token: string,
  query: { msg_signature?: string; timestamp?: string; nonce?: string },
  encrypted: string,
): boolean {
  const { msg_signature: signature, timestamp, nonce } = query;
  if (!signature || !timestamp || !nonce) return false;
  const expected = Buffer.from(computeWeComSignature(token, timestamp, nonce, encrypted));
  const given = Buffer.from(signature);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function keyOf(encodingAesKey: string): Buffer {
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  if (key.length !== 32) throw new Error("encodingAesKey must decode to 32 bytes");
  return key;
}

/**
 * Decrypt an `Encrypt` / `echostr` value.
 *
 * @throws Error when the key is malformed, the data is not a valid envelope, or it was made for
 *   another corp id
 */
export function decryptWeCom(encodingAesKey: string, encrypted: string, corpId: string): string {
  const key = keyOf(encodingAesKey);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]);
  const pad = padded[padded.length - 1] ?? 0;
  if (pad < 1 || pad > 32) throw new Error("bad padding");
  const plain = padded.subarray(0, padded.length - pad);
  if (plain.length < 20) throw new Error("envelope too short");
  const length = plain.readUInt32BE(16);
  if (20 + length > plain.length) throw new Error("bad message length");
  const receiver = plain.subarray(20 + length).toString("utf8");
  if (receiver !== corpId) throw new Error("envelope is for another corp id");
  return plain.subarray(20, 20 + length).toString("utf8");
}

/** Encrypt `message` into an envelope; used by tests and by a caller that must answer encrypted. */
export function encryptWeCom(encodingAesKey: string, message: string, corpId: string): string {
  const key = keyOf(encodingAesKey);
  const body = Buffer.from(message, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const raw = Buffer.concat([crypto.randomBytes(16), len, body, Buffer.from(corpId, "utf8")]);
  const pad = 32 - (raw.length % 32);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  const padded = Buffer.concat([raw, Buffer.alloc(pad, pad)]);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}
