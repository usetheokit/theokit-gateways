/**
 * `createTokenCache` — holds one expiring access token and shares a single refresh between every
 * concurrent caller.
 *
 * @public
 */

/** A token as the platform reported it. @public */
export interface FetchedToken {
  readonly value: string;
  /** Lifetime in seconds as the platform reported it; `defaultTtlS` when absent or not positive. */
  readonly expiresInS?: number;
}

/** Options of {@link createTokenCache}. @public */
export interface TokenCacheOptions {
  /** Fetch a fresh token. Receives the signal of the caller that started the fetch. */
  readonly fetchToken: (signal?: AbortSignal) => Promise<FetchedToken>;
  /** Refresh this long before expiry. Default 60_000. */
  readonly marginMs?: number;
  /** Default 7200. */
  readonly defaultTtlS?: number;
  readonly now?: () => number;
}

/** A cached expiring token. @public */
export interface TokenCache {
  /**
   * The cached token, or one fetch shared by every concurrent caller. `force` skips the cache
   * (but still joins a fetch already in flight). The signal of the caller that starts a fetch
   * governs it; later callers' signals do not cancel their wait.
   */
  get(options?: { force?: boolean; signal?: AbortSignal }): Promise<string>;
  /** Forget the cached token (after a 401, for example). */
  clear(): void;
}

/** Build a {@link TokenCache}. A failed fetch rejects every waiting caller and is not cached. @public */
export function createTokenCache(options: TokenCacheOptions): TokenCache {
  const marginMs = options.marginMs ?? 60_000;
  const defaultTtlS = options.defaultTtlS ?? 7200;
  const now = options.now ?? Date.now;
  let cached: { value: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;
  // Bumped by clear(), so a fetch started before it cannot repopulate the cache.
  let generation = 0;

  const refresh = (signal: AbortSignal | undefined): Promise<string> => {
    const started = generation;
    const run = (async () => {
      const fetched = await options.fetchToken(signal);
      const ttl =
        fetched.expiresInS !== undefined && fetched.expiresInS > 0
          ? fetched.expiresInS
          : defaultTtlS;
      if (started === generation) {
        cached = { value: fetched.value, expiresAt: now() + ttl * 1000 };
      }
      return fetched.value;
    })();
    const tracked = run.finally(() => {
      if (pending === tracked) pending = undefined;
    });
    pending = tracked;
    return tracked;
  };

  return {
    get(opts) {
      if (opts?.force !== true && cached !== undefined && cached.expiresAt - marginMs > now()) {
        return Promise.resolve(cached.value);
      }
      return pending ?? refresh(opts?.signal);
    },
    clear() {
      generation += 1;
      cached = undefined;
      pending = undefined;
    },
  };
}
