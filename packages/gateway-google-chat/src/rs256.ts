/**
 * RS256 JSON Web Tokens with `node:crypto` only (plan D2): split and decode a token, verify its
 * signature under a public key, and sign one with a private key.
 *
 * @internal
 */

import { Buffer } from "node:buffer";
import { type KeyObject, sign, verify } from "node:crypto";

/** A token split into its parts, with the header and payload decoded. */
export interface DecodedJwt {
  readonly header: { readonly alg?: unknown; readonly kid?: unknown };
  readonly payload: Readonly<Record<string, unknown>>;
  /** `header.payload`, the bytes the signature covers. */
  readonly signedPart: string;
  readonly signature: Buffer;
}

/** `value` as unpadded base64url. */
export function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/** Split and decode `token`, or `undefined` when it is not three base64url JSON parts. */
export function decodeJwt(token: string): DecodedJwt | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const [header, payload, signature] = parts as [string, string, string];
  try {
    const decodedHeader = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as unknown;
    const decodedPayload = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as unknown;
    if (!isObject(decodedHeader) || !isObject(decodedPayload)) return undefined;
    return {
      header: decodedHeader,
      payload: decodedPayload,
      signedPart: `${header}.${payload}`,
      signature: Buffer.from(signature, "base64url"),
    };
  } catch {
    return undefined;
  }
}

/** Whether `jwt` is RS256 and its signature verifies under `publicKey`. Never throws. */
export function verifiesRs256(jwt: DecodedJwt, publicKey: KeyObject): boolean {
  if (jwt.header.alg !== "RS256") return false;
  try {
    return verify("RSA-SHA256", Buffer.from(jwt.signedPart), publicKey, jwt.signature);
  } catch {
    return false;
  }
}

/** An RS256 token over `payload`, signed with `privateKey`. */
export function signRs256(payload: Record<string, unknown>, privateKey: KeyObject): string {
  const signedPart = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify(payload),
  )}`;
  const signature = sign("RSA-SHA256", Buffer.from(signedPart), privateKey);
  return `${signedPart}.${base64url(signature)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
