/**
 * The access token the adapter sends with, obtained by signing a service-account assertion with
 * `node:crypto` and exchanging it at Google's token endpoint (FR-028, RFC 7523's JWT bearer grant).
 *
 * @internal
 */

import type { KeyObject } from "node:crypto";

import { createTokenCache, type FetchedToken, type TokenCache } from "@theokit/gateway";

import { signRs256 } from "./rs256.js";
import type { FetchLike } from "./types.js";

export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const CHAT_BOT_SCOPE = "https://www.googleapis.com/auth/chat.bot";
/** The lifetime the assertion asks for; Google accepts at most one hour. */
const ASSERTION_LIFETIME_S = 3600;

/** The token exchange failed: the answer names why, never the key or the assertion. */
export class AccessTokenError extends Error {
  override readonly name = "AccessTokenError";
}

/** Access tokens for one service account, shared by every send until shortly before expiry. */
export class AccessTokenClient {
  private readonly cache: TokenCache;

  constructor(
    private readonly opts: {
      readonly serviceAccountEmail: string;
      readonly privateKey: KeyObject;
      readonly fetch: FetchLike;
      readonly now: () => number;
    },
  ) {
    this.cache = createTokenCache({
      fetchToken: (signal) => this.exchange(signal),
      now: opts.now,
    });
  }

  /**
   * A token valid for at least another minute. Concurrent callers share one exchange.
   *
   * @throws AccessTokenError when the exchange fails or `signal` aborts it
   */
  token(signal?: AbortSignal): Promise<string> {
    return this.cache.get(signal === undefined ? undefined : { signal });
  }

  private async exchange(signal: AbortSignal | undefined): Promise<FetchedToken> {
    const issuedAt = Math.floor(this.opts.now() / 1000);
    const assertion = signRs256(
      {
        iss: this.opts.serviceAccountEmail,
        scope: CHAT_BOT_SCOPE,
        aud: TOKEN_URL,
        iat: issuedAt,
        exp: issuedAt + ASSERTION_LIFETIME_S,
      },
      this.opts.privateKey,
    );
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    });
    let response: Response;
    try {
      response = await this.opts.fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (err) {
      throw new AccessTokenError(`token request failed: ${describe(err)}`);
    }
    const answer = (await response.json().catch(() => undefined)) as
      | { access_token?: unknown; expires_in?: unknown; error?: unknown }
      | undefined;
    if (!response.ok || typeof answer?.access_token !== "string") {
      const why = typeof answer?.error === "string" ? `: ${answer.error}` : "";
      throw new AccessTokenError(`token endpoint answered HTTP ${response.status}${why}`);
    }
    return {
      value: answer.access_token,
      ...(typeof answer.expires_in === "number" ? { expiresInS: answer.expires_in } : {}),
    };
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
