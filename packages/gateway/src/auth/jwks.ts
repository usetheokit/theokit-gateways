/**
 * A JWKS key-set cache and RS256 JWT signature verification, for platforms that sign their
 * requests with a JWT. Signature only: issuer, audience and expiry stay with the caller.
 */

import { createPublicKey, type JsonWebKey, type KeyObject, verify } from "node:crypto";

/** A key for a `kid`, `"unlisted"` when the key set does not list it, or why no key set is readable. */
export type JwksLookup = KeyObject | "unlisted" | { readonly unavailable: string };

/** Where a JWKS is read from, and how its cache behaves. */
export interface JwksKeySetOptions {
  readonly url: string;
  readonly fetch?: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
  readonly now?: () => number;
  /** Minimum time between refetches triggered by an unknown kid. Default 60_000. */
  readonly unknownKidRefetchFloorMs?: number;
  /** Serve a stale key set while one refresh runs. Default true. */
  readonly staleWhileRevalidate?: boolean;
}

/** A cache of the keys a JWKS publishes, looked up by `kid`. */
export interface JwksKeySet {
  lookup(kid: string): Promise<JwksLookup>;
}

const DEFAULT_REFETCH_FLOOR_MS = 60_000;
const READ_TIMEOUT_MS = 10_000;

interface Held {
  readonly keys: ReadonlyMap<string, KeyObject>;
  readonly freshUntil: number;
}

/**
 * A JWKS key set cached for the `max-age` its response declares. Concurrent lookups share one
 * read; a read starts at most once per `unknownKidRefetchFloorMs`. A failed read keeps the last
 * good copy.
 */
export function jwksKeySet(options: JwksKeySetOptions): JwksKeySet {
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const floor = options.unknownKidRefetchFloorMs ?? DEFAULT_REFETCH_FLOOR_MS;
  const swr = options.staleWhileRevalidate ?? true;

  let held: Held | undefined;
  let lastReadStartedAt = Number.NEGATIVE_INFINITY;
  let reading: Promise<string | undefined> | undefined;
  let lastFailure = "no read has completed";

  async function fetchKeys(): Promise<Held> {
    const response = await doFetch(options.url, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const keys = parseKeys(await response.json());
    return { keys, freshUntil: now() + maxAgeMs(response.headers.get("cache-control")) };
  }

  /** Resolves to a failure message, or `undefined` when the read succeeded. Never rejects. */
  function read(): Promise<string | undefined> {
    if (reading) return reading;
    lastReadStartedAt = now();
    const current = fetchKeys().then(
      (next) => {
        held = next;
        reading = undefined;
        return undefined;
      },
      (error: unknown) => {
        lastFailure = error instanceof Error ? error.message : String(error);
        reading = undefined;
        return lastFailure;
      },
    );
    reading = current;
    return current;
  }

  const mayRead = (): boolean => !reading && now() - lastReadStartedAt >= floor;

  function answer(kid: string): JwksLookup {
    const key = held?.keys.get(kid);
    if (key) return key;
    return held ? "unlisted" : { unavailable: lastFailure };
  }

  /** A listed key whose copy expired: refresh (shared, floor-limited), serving it meanwhile. */
  async function refreshListed(kid: string): Promise<JwksLookup> {
    const refresh = reading ?? (mayRead() ? read() : undefined);
    if (refresh && !swr) await refresh;
    return answer(kid);
  }

  /** A kid the held copy does not list, or no copy at all: a read is needed. */
  async function refreshUnknown(kid: string): Promise<JwksLookup> {
    const refresh = reading ?? (mayRead() ? read() : undefined);
    const failure = refresh ? await refresh : undefined;
    if (failure && !held?.keys.has(kid)) return { unavailable: failure };
    return answer(kid);
  }

  return {
    async lookup(kid) {
      const listed = held?.keys.get(kid);
      if (!held || !listed) return refreshUnknown(kid);
      if (now() < held.freshUntil) return listed;
      return refreshListed(kid);
    },
  };
}

function parseKey(jwk: unknown): [string, KeyObject] | undefined {
  if (typeof jwk !== "object" || jwk === null) return undefined;
  const { kid, kty, use } = jwk as Record<string, unknown>;
  if (typeof kid !== "string" || kty !== "RSA" || (use !== undefined && use !== "sig")) {
    return undefined;
  }
  try {
    return [kid, createPublicKey({ key: jwk as JsonWebKey, format: "jwk" })];
  } catch {
    return undefined; // An unusable entry is skipped; the rest of the set still serves.
  }
}

function parseKeys(body: unknown): Map<string, KeyObject> {
  const list = (body as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(list)) throw new Error("the key set has no `keys` array");
  const entries = list.map(parseKey).filter((e): e is [string, KeyObject] => e !== undefined);
  return new Map(entries);
}

function maxAgeMs(cacheControl: string | null): number {
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl ?? "");
  return match?.[1] ? Number(match[1]) * 1000 : 0;
}

/** A compact JWT split into its parts; nothing in it is verified yet. */
export interface DecodedJwt {
  readonly header: Readonly<Record<string, unknown>>;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly signingInput: string;
  readonly signature: Buffer;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Split a compact JWT into its parts without checking anything; `undefined` when malformed. */
export function decodeJwt(token: string): DecodedJwt | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const [h, p, s] = parts as [string, string, string];
  if (![h, p, s].every((part) => BASE64URL.test(part))) return undefined;
  const header = jsonObject(h);
  const payload = jsonObject(p);
  if (!header || !payload) return undefined;
  return { header, payload, signingInput: `${h}.${p}`, signature: Buffer.from(s, "base64url") };
}

function jsonObject(segment: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The outcome of checking a token's signature: its claims, or why it was refused. */
export type VerifyJwtResult =
  | {
      readonly ok: true;
      readonly header: DecodedJwt["header"];
      readonly payload: DecodedJwt["payload"];
    }
  | {
      readonly ok: false;
      readonly reason:
        | "malformed"
        | "unsupported_alg"
        | "unknown_kid"
        | "keys_unavailable"
        | "bad_signature";
    };

/** Signature only. Issuer, audience and expiry stay with the caller. */
export async function verifyRs256Jwt(token: string, keys: JwksKeySet): Promise<VerifyJwtResult> {
  const jwt = decodeJwt(token);
  if (!jwt) return { ok: false, reason: "malformed" };
  if (jwt.header.alg !== "RS256") return { ok: false, reason: "unsupported_alg" };
  const kid = jwt.header.kid;
  if (typeof kid !== "string" || kid === "") return { ok: false, reason: "malformed" };
  const found = await keys.lookup(kid);
  if (found === "unlisted") return { ok: false, reason: "unknown_kid" };
  if ("unavailable" in found) return { ok: false, reason: "keys_unavailable" };
  let valid = false;
  try {
    valid = verify("RSA-SHA256", Buffer.from(jwt.signingInput), found, jwt.signature);
  } catch {
    valid = false;
  }
  return valid
    ? { ok: true, header: jwt.header, payload: jwt.payload }
    : { ok: false, reason: "bad_signature" };
}
