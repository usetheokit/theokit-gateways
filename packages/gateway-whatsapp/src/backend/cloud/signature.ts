/**
 * Meta's `X-Hub-Signature-256` check for a Cloud webhook body (ADR D312).
 *
 * Its own module, apart from the envelope normalizers in `webhook.ts`, because this is the line
 * between a signed webhook and anyone's POST, and mutation testing measures it file by file.
 *
 * @public
 */

import * as crypto from "node:crypto";

import { ConfigurationError } from "../../errors.js";

/**
 * Verify the `X-Hub-Signature-256` HMAC-SHA256 against the app secret (D312).
 *
 * EC-3 absorbed: length-guard BEFORE `timingSafeEqual` so a malformed header
 * (e.g. `sha256=ab`) returns `false` instead of throwing `RangeError` (DoS).
 *
 * An empty or whitespace-only `appSecret` throws rather than answering: an HMAC under an empty
 * key is computable by anyone, so a match would prove nothing about Meta. `fromCloud` accepts an
 * empty secret for an adapter that only sends; such an adapter cannot verify a webhook.
 *
 * @returns `true` iff the signature matches.
 * @throws {ConfigurationError} `missing_option` when `appSecret` is empty or whitespace only.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (appSecret.trim().length === 0) {
    throw new ConfigurationError({
      code: "missing_option",
      message:
        "gateway-whatsapp: appSecret is required to verify a webhook signature and must not be empty; an HMAC under an empty key is computable by anyone.",
    });
  }
  if (signatureHeader === undefined) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;
  const receivedHex = signatureHeader.slice(7);
  if (!/^[0-9a-f]+$/i.test(receivedHex)) return false;
  const received = Buffer.from(receivedHex, "hex");
  // `update` reads a string as UTF-8 and a Buffer as its bytes, which is what Meta signed.
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest();
  // EC-3: length guard before timingSafeEqual.
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(received, expected);
}
