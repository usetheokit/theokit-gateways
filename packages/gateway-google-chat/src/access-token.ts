/**
 * The access token the adapter sends with, obtained by signing a service-account assertion with
 * `node:crypto` and exchanging it at Google's token endpoint (FR-028, RFC 7523's JWT bearer grant).
 *
 * @internal
 */

import type { KeyObject } from "node:crypto";

import { signRs256 } from "./rs256.js";
import type { FetchLike } from "./types.js";

export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const CHAT_BOT_SCOPE = "https://www.googleapis.com/auth/chat.bot";
/** A held token is replaced this long before it expires. */
const REFRESH_MARGIN_MS = 60_000;
/** The lifetime the assertion asks for; Google accepts at most one hour. */
const ASSERTION_LIFETIME_S = 3600;

/** The token exchange failed: the answer names why, never the key or the assertion. */
export class AccessTokenError extends Error {
  override readonly name = "AccessTokenError";
}

/** Access tokens for one service account, shared by every send until shortly before expiry. */
export class AccessTokenClient {
  private held: { readonly token: string; readonly expiresAt: number } | undefined;
  private pending: Promise<string> | undefined;

  constructor(
    private readonly opts: {
      readonly serviceAccountEmail: string;
      readonly privateKey: KeyObject;
      readonly fetch: FetchLike;
      readonly now: () => number;
    },
  ) {}

  /**
   * A token valid for at least another minute. Concurrent callers share one exchange.
   *
   * @throws AccessTokenError when the exchange fails or `signal` aborts it
   */
  token(signal?: AbortSignal): Promise<string> {
    const held = this.held;
    if (held !== undefined && this.opts.now() < held.expiresAt - REFRESH_MARGIN_MS) {
      return Promise.resolve(held.token);
    }
    this.pending ??= this.exchange(signal).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async exchange(signal: AbortSignal | undefined): Promise<string> {
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
    const lifetimeS = typeof answer.expires_in === "number" ? answer.expires_in : 0;
    this.held = { token: answer.access_token, expiresAt: this.opts.now() + lifetimeS * 1000 };
    return answer.access_token;
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
