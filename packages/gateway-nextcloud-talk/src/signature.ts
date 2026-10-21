/**
 * Nextcloud Talk's bot signature, in both directions.
 *
 * Talk signs a webhook as hex HMAC-SHA256 over `X-Nextcloud-Talk-Random` followed by the raw
 * body, and checks a bot's message the same way over its own random followed by the message
 * text. Measured on spreed 21.1.11 (Q6 probe, 2026-10-21): a signature over the body alone, the
 * shape LINE uses, matched no inbound request, and a bot message signed that way answered 401.
 *
 * @public
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Hex HMAC-SHA256 of `random + payload` under `secret`.
 *
 * @public
 */
export function talkSignature(secret: string, random: string, payload: string): string {
  return createHmac("sha256", secret)
    .update(random + payload)
    .digest("hex");
}

/**
 * Whether `signature` is Talk's signature of `random + rawBody` under `secret`.
 *
 * Answers `false` for a missing, malformed or mismatched value and never throws, so a hostile
 * header cannot become an unhandled error on the webhook path. The comparison is constant-time
 * once the lengths match. `rawBody` must be the bytes as received: a re-serialised body signs
 * differently.
 *
 * @public
 */
export function verifyTalkSignature(
  secret: string,
  random: string | undefined,
  rawBody: string,
  signature: string | undefined,
): boolean {
  if (random === undefined || random === "" || signature === undefined || signature === "") {
    return false;
  }
  const expected = Buffer.from(talkSignature(secret, random, rawBody));
  const received = Buffer.from(signature.toLowerCase());
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
