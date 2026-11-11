/**
 * Options and wire shapes of `XAdapter`.
 *
 * @public
 */

/** A `fetch`-shaped function; the adapter's only network seam. @public */
export type XFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

/** Guest mode: mentions from accounts outside `allowFrom`, capped per author per UTC day. @public */
export interface XGuestOptions {
  /** How many mentions one non-allowlisted author may get answered per UTC day. */
  readonly dailyLimit: number;
}

/** Credentials, policy and seams for `XAdapter`. @public */
export interface XAdapterOptions {
  /**
   * The bot account's numeric user id.
   *
   * @platform-term user id (X)
   * @issued-at the X API, `GET /2/users/by/username/{username}`
   */
  readonly userId: string;
  /** The bot account's handle, with or without the `@`; removed from the start of mention text. */
  readonly username: string;
  /**
   * The OAuth 2.0 client id of the X developer app (a confidential client).
   *
   * @platform-term Client ID (X)
   * @issued-at the X developer portal, the app's Keys and tokens page
   */
  readonly clientId: string;
  /**
   * The OAuth 2.0 client secret of the app.
   *
   * @platform-term Client Secret (X)
   * @issued-at the X developer portal, the app's Keys and tokens page
   */
  readonly clientSecret: string;
  /**
   * A refresh token of the bot account (scopes `tweet.read tweet.write users.read offline.access`).
   * X rotates it on every refresh; see `onRefreshToken`.
   *
   * @platform-term refresh token (X)
   * @issued-at the OAuth 2.0 authorization-code flow with PKCE, run once as the bot account
   */
  readonly refreshToken: string;
  /**
   * An app-only bearer token used to read mentions instead of the account's access token.
   *
   * @platform-term Bearer Token (X)
   * @issued-at the X developer portal, the app's Keys and tokens page
   */
  readonly bearerToken?: string;
  /** Handles (with or without `@`) or user ids whose mentions are answered. Others get no reply. */
  readonly allowFrom: readonly string[];
  /** Answer other authors too, up to a daily cap each. Off when absent. */
  readonly guest?: XGuestOptions;
  /** Called with each new refresh token X issues; persist it, the old one stops working. */
  readonly onRefreshToken?: (refreshToken: string) => void | Promise<void>;
  /** Milliseconds between polls for mentions. Default 60000; `0` turns the timer off (`poll()` only). */
  readonly pollIntervalMs?: number;
  /** The most ancestor tweets read for one mention. Default 5. */
  readonly maxThreadDepth?: number;
  /** Override the API base, `https://api.x.com`. */
  readonly apiBase?: string;
  /** Test seam; defaults to global `fetch`. */
  readonly fetch?: XFetch;
  /** Test seam for the clock, ms since epoch; defaults to `Date.now`. */
  readonly now?: () => number;
}

/** A tweet as the X API v2 returns it, with the fields this adapter asks for. @public */
export interface XTweet {
  readonly id: string;
  readonly text?: string;
  readonly author_id?: string;
  readonly conversation_id?: string;
  readonly created_at?: string;
  readonly referenced_tweets?: readonly { readonly type: string; readonly id: string }[];
}

/** A user as the X API v2 returns it. @public */
export interface XUser {
  readonly id: string;
  readonly username?: string;
}
