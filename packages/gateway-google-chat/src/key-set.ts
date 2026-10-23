/**
 * Google's published signing keys, read by this package on its own schedule (FR-026, the shape
 * ADR-0005 chose for Teams): a sender decides which `kid` a token names, never when a read happens.
 *
 * @internal
 */

import { createPublicKey, type JsonWebKey, type KeyObject } from "node:crypto";

import type { FetchLike } from "./types.js";

/** Google's OAuth 2.0 signing keys as a JWK set, the keys that sign Chat's ID tokens. */
export const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";

/** The least time between two reads asked for by a `kid` the held copy does not list. */
export const UNKNOWN_KID_REFETCH_FLOOR_MS = 60_000;

/** How long one read may take before it counts as failed. */
const READ_TIMEOUT_MS = 10_000;

/** No key set could be read, so a token's signature cannot be checked at all (answered 503). */
export class KeySetUnavailableError extends Error {
  override readonly name = "KeySetUnavailableError";
}

/** The keys a verifier asks for by `kid`. */
export interface KeySet {
  /**
   * The key for `kid`, or `undefined` when the set does not list it.
   *
   * @throws KeySetUnavailableError when no key set could be read
   */
  forKid(kid: string): Promise<KeyObject | undefined>;
}

interface Held {
  readonly keys: ReadonlyMap<string, KeyObject>;
  /** When the copy stops being fresh, from the response's `Cache-Control: max-age`. */
  readonly freshUntil: number;
}

/**
 * Google's key set, cached for the `max-age` its response declares. A fresh copy answers every
 * `kid` it lists without a read; anything else (a `kid` it does not list, an expired copy, no copy
 * after a failed read) starts a read only when none was started in the last
 * {@link UNKNOWN_KID_REFETCH_FLOOR_MS}, and is answered from the held copy meanwhile.
 * Concurrent lookups share the read in flight. A
 * failed read keeps the last good copy, and answers {@link KeySetUnavailableError} only when there
 * is none.
 */
export function googleKeySet(opts: {
  readonly fetch: FetchLike;
  readonly now: () => number;
  readonly url?: string;
}): KeySet {
  const url = opts.url ?? GOOGLE_CERTS_URL;
  let held: Held | undefined;
  let lastReadStartedAt = Number.NEGATIVE_INFINITY;
  let reading: Promise<void> | undefined;
  let lastFailure = "no read has completed";

  const read = (): Promise<void> => {
    reading ??= (async () => {
      lastReadStartedAt = opts.now();
      const outcome = await readKeySet(opts.fetch, url, opts.now);
      if (typeof outcome === "string") lastFailure = outcome;
      else held = outcome;
    })().finally(() => {
      reading = undefined;
    });
    return reading;
  };

  return {
    async forKid(kid) {
      const now = opts.now();
      const fresh = held !== undefined && now < held.freshUntil;
      if (fresh && held?.keys.has(kid)) return held.keys.get(kid);
      // Every read, the first excepted, waits out the floor: neither an unknown kid nor an expired
      // copy nor a failing endpoint lets requests drive reads back to back.
      const mayRead = now - lastReadStartedAt >= UNKNOWN_KID_REFETCH_FLOOR_MS;
      if (mayRead || reading !== undefined) await read();
      if (held === undefined) {
        throw new KeySetUnavailableError(
          `Google's key set at ${url} could not be read: ${lastFailure}`,
        );
      }
      return held.keys.get(kid);
    },
  };
}

/** One read of the key set, or why it failed. */
async function readKeySet(
  fetch: FetchLike,
  url: string,
  now: () => number,
): Promise<Held | string> {
  let response: Response;
  try {
    // A redirect is a failed read: the keys come only from the configured URL.
    response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  } catch (err) {
    return `the request failed (${err instanceof Error ? err.name : "unknown error"})`;
  }
  if (!response.ok) return `HTTP ${response.status}`;
  let document: unknown;
  try {
    document = await response.json();
  } catch {
    return "the document is not JSON";
  }
  const keys = rsaKeys(document);
  if (keys.size === 0) return "the document lists no usable RSA key";
  return { keys, freshUntil: now() + maxAgeMs(response.headers.get("cache-control")) };
}

/** The RSA keys of a JWK set by `kid`; entries that are not usable RSA keys are skipped. */
function rsaKeys(document: unknown): Map<string, KeyObject> {
  const keys = new Map<string, KeyObject>();
  const entries = (document as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(entries)) return keys;
  for (const entry of entries) {
    const kid = (entry as { kid?: unknown } | null)?.kid;
    if (typeof kid !== "string" || kid === "") continue;
    try {
      const key = createPublicKey({ key: entry as JsonWebKey, format: "jwk" });
      if (key.asymmetricKeyType === "rsa") keys.set(kid, key);
    } catch {
      // Not a usable key; the rest of the set still is.
    }
  }
  return keys;
}

/** `max-age` of a `Cache-Control` header in ms, or 0 when it declares none. */
function maxAgeMs(cacheControl: string | null): number {
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl ?? "");
  return match === null ? 0 : Number(match[1]) * 1000;
}
