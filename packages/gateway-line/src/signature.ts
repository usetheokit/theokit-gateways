/**
 * LINE HMAC-SHA256 signature verification (D408).
 *
 * Per LINE Developers docs:
 *   signature = base64(hmac_sha256(channelSecret, rawBody))
 *
 * Carried in header `X-Line-Signature`.
 *
 * Verification goes through core `verifyHmac`, which compares in constant time.
 */

import crypto from "node:crypto";

import { verifyHmac } from "@theokit/gateway";

export function computeLineSignature(channelSecret: string, rawBody: string): string {
  return crypto.createHmac("sha256", channelSecret).update(rawBody, "utf8").digest("base64");
}

/**
 * Verify LINE's `x-line-signature` header against the raw request body.
 *
 * Returns `false` for a missing, malformed or mismatched signature — never throws, so a hostile
 * header cannot become an unhandled error on the webhook path. Compare against the RAW body: any
 * re-serialisation of the parsed JSON changes the bytes and invalidates the signature.
 */
export function verifyLineSignature(
  channelSecret: string,
  rawBody: string,
  signatureHeader: string | undefined,
): boolean {
  if (channelSecret.length === 0) return false;
  return verifyHmac({
    algorithm: "sha256",
    secrets: channelSecret,
    message: rawBody,
    signature: signatureHeader,
    encoding: "base64",
  });
}
