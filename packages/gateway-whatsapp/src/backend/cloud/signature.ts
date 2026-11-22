/**
 * Meta's `X-Hub-Signature-256` check for a Cloud webhook body (ADR D312).
 *
 * Its own module, apart from the envelope normalizers in `webhook.ts`, because this is the line
 * between a signed webhook and anyone's POST, and mutation testing measures it file by file.
 *
 * @public
 */

import { verifyHmac } from "@theokit/gateway";

import { ConfigurationError } from "../../errors.js";

/**
 * Verify the `X-Hub-Signature-256` HMAC-SHA256 against the app secret (D312).
 *
 * A malformed header (e.g. `sha256=ab`) returns `false`; core `verifyHmac` compares in constant time.
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
  return verifyHmac({
    algorithm: "sha256",
    secrets: appSecret,
    message: rawBody,
    signature: signatureHeader,
    encoding: "hex",
    prefix: "sha256=",
    caseInsensitive: true,
  });
}
