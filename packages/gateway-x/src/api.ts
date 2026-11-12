/**
 * The slice of the X API v2 this adapter uses: the OAuth 2.0 refresh, reading mentions and
 * tweets, and posting a reply.
 */

import type { XAdapterOptions, XFetch, XTweet, XUser } from "./types.js";

const DEFAULT_BASE = "https://api.x.com";
const REQUEST_TIMEOUT_MS = 30_000;
/** Refresh this long before the token's stated expiry. */
const TOKEN_MARGIN_MS = 60_000;

const TWEET_FIELDS = "author_id,conversation_id,created_at,referenced_tweets,text";
const EXPANSIONS = "author_id,referenced_tweets.id,referenced_tweets.id.author_id";

const defaultFetch: XFetch = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { status: res.status, text: () => res.text() };
};

/** A page of tweets with the objects they expand. */
export interface XPage {
  readonly tweets: readonly XTweet[];
  readonly included: ReadonlyMap<string, XTweet>;
  readonly users: ReadonlyMap<string, XUser>;
  readonly newestId: string | undefined;
}

interface Body {
  data?: unknown;
  includes?: { tweets?: XTweet[]; users?: XUser[] };
  meta?: { newest_id?: string };
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  title?: string;
  detail?: string;
  error?: string;
  error_description?: string;
  errors?: { message?: string }[];
}

/** An error answer from X, with its HTTP status. */
export class XApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function describe(status: number, body: Body | undefined): string {
  const why =
    body?.detail ??
    body?.error_description ??
    body?.errors?.[0]?.message ??
    body?.title ??
    body?.error ??
    "no detail";
  return `X answered HTTP ${status}: ${why}`;
}

/** Calls the X API for one bot account. */
export class XApi {
  private readonly doFetch: XFetch;
  private readonly base: string;
  private accessToken: { value: string; expiresAt: number } | undefined;
  private refreshToken: string;
  private refreshing: Promise<string> | undefined;

  constructor(
    private readonly opts: XAdapterOptions,
    private readonly now: () => number,
  ) {
    this.doFetch = opts.fetch ?? defaultFetch;
    this.base = opts.apiBase ?? DEFAULT_BASE;
    this.refreshToken = opts.refreshToken;
  }

  /** Exchange the refresh token for an access token, and keep the rotated refresh token. Concurrent callers share one request. */
  refresh(): Promise<string> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<string> {
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString("base64");
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_id: this.opts.clientId,
    });
    const { status, body } = await this.request(
      "POST",
      "/2/oauth2/token",
      {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      form.toString(),
    );
    if (status !== 200 || !body?.access_token) throw new XApiError(status, describe(status, body));
    this.accessToken = {
      value: body.access_token,
      expiresAt: this.now() + (body.expires_in ?? 7200) * 1000,
    };
    if (body.refresh_token && body.refresh_token !== this.refreshToken) {
      this.refreshToken = body.refresh_token;
      await this.opts.onRefreshToken?.(body.refresh_token);
    }
    return body.access_token;
  }

  private async userToken(): Promise<string> {
    const cached = this.accessToken;
    if (cached !== undefined && cached.expiresAt - TOKEN_MARGIN_MS > this.now())
      return cached.value;
    return this.refresh();
  }

  /** Mentions of the bot newer than `sinceId`, oldest first. */
  async mentions(sinceId: string | undefined, maxResults: number): Promise<XPage> {
    const q = new URLSearchParams({
      max_results: String(maxResults),
      "tweet.fields": TWEET_FIELDS,
      expansions: EXPANSIONS,
      "user.fields": "username",
    });
    if (sinceId !== undefined) q.set("since_id", sinceId);
    const token = this.opts.bearerToken ?? (await this.userToken());
    const page = await this.get(`/2/users/${this.opts.userId}/mentions?${q}`, token);
    return { ...page, tweets: [...page.tweets].reverse() };
  }

  /** One tweet with its author, or `undefined` when X has no such visible tweet. */
  async tweet(
    id: string,
  ): Promise<{ tweet: XTweet; users: ReadonlyMap<string, XUser> } | undefined> {
    const q = new URLSearchParams({
      "tweet.fields": TWEET_FIELDS,
      expansions: "author_id",
      "user.fields": "username",
    });
    const token = this.opts.bearerToken ?? (await this.userToken());
    try {
      const page = await this.get(`/2/tweets/${encodeURIComponent(id)}?${q}`, token);
      const tweet = page.tweets[0];
      return tweet === undefined ? undefined : { tweet, users: page.users };
    } catch (err) {
      if (err instanceof XApiError && (err.status === 403 || err.status === 404)) return undefined;
      throw err;
    }
  }

  /** Post `text` as a public reply to `inReplyTo`; returns the new tweet's id. */
  async reply(text: string, inReplyTo: string): Promise<string> {
    const send = async (token: string) =>
      this.request(
        "POST",
        "/2/tweets",
        { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        JSON.stringify({ text, reply: { in_reply_to_tweet_id: inReplyTo } }),
      );
    let res = await send(await this.userToken());
    if (res.status === 401) res = await send(await this.refresh());
    const data = res.body?.data as { id?: string } | undefined;
    if (res.status < 200 || res.status >= 300 || !data?.id) {
      throw new XApiError(res.status, describe(res.status, res.body));
    }
    return data.id;
  }

  private async get(path: string, token: string): Promise<XPage> {
    const { status, body } = await this.request("GET", path, { Authorization: `Bearer ${token}` });
    if (status !== 200 || body === undefined) throw new XApiError(status, describe(status, body));
    const data = body.data;
    if (data !== undefined && (typeof data !== "object" || data === null)) {
      throw new XApiError(status, "X answered a malformed body");
    }
    const tweets = (Array.isArray(data) ? data : data === undefined ? [] : [data]) as XTweet[];
    return {
      tweets,
      included: new Map((body.includes?.tweets ?? []).map((t) => [t.id, t])),
      users: new Map((body.includes?.users ?? []).map((u) => [u.id, u])),
      newestId: body.meta?.newest_id,
    };
  }

  private async request(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<{ status: number; body: Body | undefined }> {
    const res = await this.doFetch(this.base + path, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    });
    const text = await res.text();
    try {
      return { status: res.status, body: JSON.parse(text) as Body };
    } catch {
      return { status: res.status, body: undefined };
    }
  }
}
