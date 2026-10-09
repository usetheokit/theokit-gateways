/**
 * The RS256 signature check the verifier runs before the SDK is asked (ADR-0005). It uses only
 * `node:crypto`; the key comes from `published-key-set.ts`.
 *
 * @internal
 */

import { Buffer } from "node:buffer";
import { type KeyObject, verify } from "node:crypto";

/** Whether `rawToken`'s RS256 signature verifies under `publicKey`. Never throws. */
export function verifiesRs256(rawToken: string, publicKey: KeyObject): boolean {
  const [header, payload, signature] = rawToken.split(".");
  if (header === undefined || payload === undefined || signature === undefined) return false;
  try {
    return verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}
