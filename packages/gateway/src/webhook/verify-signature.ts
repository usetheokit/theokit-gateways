import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Text encoding of a digest as sent in a webhook header. */
export type DigestEncoding = "hex" | "base64" | "base64url";

/** Constant-time string compare; false (never a throw) on length mismatch or an empty side. */
export function safeEqualString(expected: string, received: string): boolean {
  if (typeof expected !== "string" || typeof received !== "string") return false;
  if (expected.length === 0 || received.length === 0) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Options for {@link verifyHmac}. */
export interface VerifyHmacOptions {
  readonly algorithm: "sha256" | "sha1";
  /** One secret, or several to accept during rotation. An empty secret throws RangeError. */
  readonly secrets: string | readonly string[];
  readonly message: string | Uint8Array;
  /** The header value as received; `undefined` or "" fails. */
  readonly signature: string | undefined;
  readonly encoding: DigestEncoding;
  /** Stripped before compare, e.g. "sha256=". A header without it fails. */
  readonly prefix?: string;
  /** Hex compare ignores case when true. Default false. */
  readonly caseInsensitive?: boolean;
}

function stripPrefix(signature: string | undefined, prefix: string | undefined): string | null {
  if (typeof signature !== "string" || signature.length === 0) return null;
  if (!prefix) return signature;
  if (!signature.startsWith(prefix)) return null;
  const rest = signature.slice(prefix.length);
  return rest.length === 0 ? null : rest;
}

function normalize(value: string, encoding: DigestEncoding, caseInsensitive: boolean): string {
  return encoding === "hex" && caseInsensitive ? value.toLowerCase() : value;
}

/** Verify an HMAC webhook signature in constant time, accepting any of the given secrets. */
export function verifyHmac(opts: VerifyHmacOptions): boolean {
  const secrets = typeof opts.secrets === "string" ? [opts.secrets] : [...opts.secrets];
  if (secrets.length === 0 || secrets.some((s) => typeof s !== "string" || s.length === 0)) {
    throw new RangeError(
      "verifyHmac: `secrets` must be a non-empty string or a non-empty list of non-empty strings",
    );
  }
  const received = stripPrefix(opts.signature, opts.prefix);
  if (received === null) return false;
  const ci = opts.caseInsensitive === true;
  const got = normalize(received, opts.encoding, ci);
  let ok = false;
  for (const secret of secrets) {
    const expected = createHmac(opts.algorithm, secret).update(opts.message).digest(opts.encoding);
    if (safeEqualString(normalize(expected, opts.encoding, ci), got)) ok = true;
  }
  return ok;
}

/** Plain digest (no key), for platforms that hash secret+fields: zalo, wechat, wecom. */
export function verifyDigest(opts: {
  algorithm: "sha256" | "sha1";
  message: string;
  signature: string | undefined;
  encoding: DigestEncoding;
  prefix?: string;
}): boolean {
  const received = stripPrefix(opts.signature, opts.prefix);
  if (received === null) return false;
  const expected = createHash(opts.algorithm).update(opts.message).digest(opts.encoding);
  return safeEqualString(expected, received);
}
