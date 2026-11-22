/**
 * Outbound RS256 signing with `node:crypto` only (plan D2). Inbound verification is the core
 * `verifyRs256Jwt`.
 *
 * @internal
 */

import { Buffer } from "node:buffer";
import { type KeyObject, sign } from "node:crypto";

/** `value` as unpadded base64url. */
export function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/** An RS256 token over `payload`, signed with `privateKey`. */
export function signRs256(payload: Record<string, unknown>, privateKey: KeyObject): string {
  const signedPart = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify(payload),
  )}`;
  const signature = sign("RSA-SHA256", Buffer.from(signedPart), privateKey);
  return `${signedPart}.${base64url(signature)}`;
}
