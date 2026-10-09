/**
 * The published key sets the verifier reads itself (ADR-0005): where each one is, how it is read,
 * and the cache that decides when a read may happen, whatever a sender sends.
 *
 * @internal
 */

import { createPublicKey, type JsonWebKey, type KeyObject } from "node:crypto";

import { readBoundedStream } from "./bounded-stream.js";
import { errorKind } from "./error-kind.js";

/** `PUBLIC.openIdMetadataUrl` in `@microsoft/teams.api`. */
const DEFAULT_OPENID_METADATA_URL =
  "https://login.botframework.com/v1/.well-known/openidconfiguration";

/**
 * The least time between the end of one read of a key set and the start of the next, whatever asks
 * for the read.
 */
const KEY_SET_READ_INTERVAL_MS = 10_000;

/**
 * The age at which a held key set is read again even though it lists the key asked for, so a key
 * Microsoft retired stops verifying once that read completes. The read runs in the background: the
 * key is answered from the held copy meanwhile. A proposal, not a measurement: the SDK's own key
 * client, which still checks every token after this verifier, keeps a key for 10 minutes.
 */
const KEY_SET_MAX_AGE_MS = 60 * 60 * 1000;

/** How long one read of a key set may take before it counts as failed. */
const KEY_SET_READ_TIMEOUT_MS = 10_000;

/** The largest key-set document the verifier reads. Microsoft's is far smaller. */
const MAX_KEY_SET_BYTES = 1024 * 1024;

/** The most keys one key-set document may list; a document listing more is a failed read. */
const MAX_KEYS_PER_SET = 1000;

const ignore = (): void => {};

/**
 * The key-set URL the SDK validator derives from the cloud's OpenID metadata URL: both 2.0.15 and
 * 2.1.0 replace a trailing `/openidconfiguration` with `/keys` and fetch that, without reading the
 * metadata document. Construction refuses a metadata URL without that suffix.
 */
export function keySetUrl(openIdMetadataUrl: string | undefined): string {
  const metadata = openIdMetadataUrl ?? DEFAULT_OPENID_METADATA_URL;
  return metadata.replace(/\/openidconfiguration$/, "/keys");
}

/** The key-set URL SDK 2.1.x derives for a tenant-issued token naming `tenantId`. */
export function tenantKeySetUrl(loginEndpoint: string, tenantId: string): string {
  return `${loginEndpoint}/${tenantId}/discovery/v2.0/keys`;
}

/** Why one read of a key set produced no key set, in words an operator can act on. */
interface KeySetReadFailure {
  readonly failed: string;
}

/**
 * The `key_set_unavailable` message for one key set: which set, its URL, and why its latest read
 * failed. All three come from the configuration and the key endpoint, none from the request.
 */
function keySetUnavailableMessage(
  label: string,
  url: string,
  failure: KeySetReadFailure | undefined,
): string {
  const why = failure === undefined ? "" : `: ${failure.failed}`;
  return `the published signing keys could not be read (${label} key set at ${url}${why}), so the token's signature could not be checked; a retry may succeed`;
}

/** An RSA public key from one key-set entry, or `undefined` when the entry holds none. */
function rsaPublicKey(
  entry: unknown,
): { readonly kid: string; readonly publicKey: KeyObject } | undefined {
  const kid = (entry as { kid?: unknown } | null)?.kid;
  if (typeof kid !== "string" || kid.length === 0) return undefined;
  try {
    const publicKey = createPublicKey({ key: entry as JsonWebKey, format: "jwk" });
    return publicKey.asymmetricKeyType === "rsa" ? { kid, publicKey } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The RSA keys of a key-set document by `kid`, or the failure when it is not one: no `keys` array,
 * more than {@link MAX_KEYS_PER_SET} entries, or no entry holding a usable RSA key. An entry with
 * no usable RSA key is skipped, but a document with none at all is a failed read: it is an empty,
 * truncated or proxied answer from the key endpoint, and taken as the key set it would replace the
 * last good copy and turn every genuine token into a non-retryable refusal.
 */
function publishedKeys(document: unknown): Map<string, KeyObject> | KeySetReadFailure {
  const entries = (document as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(entries)) return { failed: "the document has no keys array" };
  if (entries.length > MAX_KEYS_PER_SET) {
    return { failed: `the document lists more than ${MAX_KEYS_PER_SET} keys` };
  }
  const found = new Map<string, KeyObject>();
  for (const entry of entries) {
    const usable = rsaPublicKey(entry);
    if (usable !== undefined) found.set(usable.kid, usable.publicKey);
  }
  if (found.size === 0) return { failed: "the document lists no usable RSA key" };
  return found;
}

/**
 * A failed request or body read: the timeout, or the network error's class and code (`TypeError`
 * from `fetch` carries the socket error, e.g. `ECONNREFUSED`, as its `cause`). Never the error's
 * text.
 */
function requestFailure(error: unknown): KeySetReadFailure {
  if ((error as { name?: unknown } | null)?.name === "TimeoutError") {
    return { failed: `no answer within ${KEY_SET_READ_TIMEOUT_MS / 1000} s` };
  }
  const cause = (error as { cause?: unknown } | null)?.cause;
  return { failed: `the request failed (${errorKind(cause ?? error)})` };
}

/** The body of a key-set response as text, or the failure: too large, or the read failed. */
async function readKeySetText(response: Response): Promise<string | KeySetReadFailure> {
  try {
    const text = await readBoundedStream(response.body, MAX_KEY_SET_BYTES);
    return text ?? { failed: `the document is over ${MAX_KEY_SET_BYTES} bytes` };
  } catch (error) {
    return requestFailure(error);
  }
}

/** Fetch a key set, or the reason it could not be had: network, status, timeout, size or shape. */
async function readKeySet(url: string): Promise<Map<string, KeyObject> | KeySetReadFailure> {
  let response: Response;
  try {
    // A redirect is a failed read: the keys come only from the URL the cloud configured.
    response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(KEY_SET_READ_TIMEOUT_MS),
    });
  } catch (error) {
    return requestFailure(error);
  }
  if (!response.ok) {
    // The status is the failure reported; a body that will not cancel changes nothing about it.
    await response.body?.cancel().catch(ignore);
    return { failed: `HTTP ${response.status}` };
  }
  const text = await readKeySetText(response);
  if (typeof text !== "string") return text;
  try {
    return publishedKeys(JSON.parse(text));
  } catch {
    return { failed: "the document is not JSON" };
  }
}

/**
 * What a key set answers for a `kid`: the key, `unlisted` after a read that succeeded without it,
 * or `unavailable` with the refusal message naming the set and why its latest read failed.
 */
export type KeyLookup = KeyObject | "unlisted" | { readonly unavailable: string };

/** One published key set. */
export interface PublishedKeySet {
  lookup(kid: string): Promise<KeyLookup>;
}

/**
 * One published key set, read by this verifier and nothing else. A `kid` the held copy lists is
 * answered from it at once; when the copy is older than {@link KEY_SET_MAX_AGE_MS}, a read is
 * started in the background and not awaited (stale-while-revalidate). A `kid` the copy lacks, or
 * any `kid` when there is no copy, waits for a read. Concurrent lookups share the read in flight,
 * and no read starts within {@link KEY_SET_READ_INTERVAL_MS} of the end of the previous one (so
 * nor of its start), whatever asked: an endpoint that hangs until the read times out cannot drive
 * reads back to back. A successful read replaces the copy, so a retired key is gone after it; a
 * failed read, which includes a document listing no usable RSA key, keeps the last good copy. A
 * `kid` missing after a successful read is `unlisted`; one missing when there is no copy, or when
 * the latest read failed, is `unavailable`.
 */
export function keySet(label: string, url: string): PublishedKeySet {
  // Times are read from the monotonic clock: a wall clock stepped back would hold the next read
  // off by the size of the step, and one stepped forward would age the held copy early.
  let held: Map<string, KeyObject> | undefined;
  let readAt = Number.NEGATIVE_INFINITY;
  let nextReadAt = Number.NEGATIVE_INFINITY;
  /** Why the latest read failed; `undefined` once a read succeeds. */
  let lastFailure: KeySetReadFailure | undefined;
  let reading: Promise<void> | undefined;
  /** Never rejects: {@link readKeySet} turns every failure into a value. */
  const read = async (): Promise<void> => {
    const fresh = await readKeySet(url);
    if (fresh instanceof Map) {
      lastFailure = undefined;
      held = fresh;
      readAt = performance.now();
    } else lastFailure = fresh;
  };
  const unavailable = (): KeyLookup => ({
    unavailable: keySetUnavailableMessage(label, url, lastFailure),
  });
  /** The read in flight, started now if none is and the interval allows one. */
  const currentRead = (now: number): Promise<void> | undefined => {
    if (reading === undefined && now >= nextReadAt) {
      reading = read().finally(() => {
        nextReadAt = performance.now() + KEY_SET_READ_INTERVAL_MS;
        reading = undefined;
      });
    }
    return reading;
  };
  return {
    async lookup(kid) {
      const now = performance.now();
      const listed = held?.get(kid);
      if (listed !== undefined) {
        if (now - readAt >= KEY_SET_MAX_AGE_MS) void currentRead(now);
        return listed;
      }
      await currentRead(now);
      const found = held?.get(kid);
      if (found !== undefined) return found;
      return held === undefined || lastFailure !== undefined ? unavailable() : "unlisted";
    },
  };
}
