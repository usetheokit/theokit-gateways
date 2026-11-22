/**
 * The slice of the X API v2 this adapter uses: the OAuth 2.0 refresh, reading mentions and
 * tweets, and posting a reply.
 */

import { createTokenCache, type TokenCache } from "@theokit/gateway";

import type { XAdapterOptions, XFetch, XTweet, XUser } from "./types.js";

const DEFAULT_BASE = "https://api.x.com";
const REQUEST_TIMEOUT_MS = 30_000;

const TWEET_FIELDS = "author_id,conversation_id,created_at,referenced_tweets,text";
const EXPANSIONS = "author_id,referenced_tweets.id,referenced_tweets.id.author_id";

const defaultFetch: XFetch = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { status: res.status, text: () => res.text(), headers: res.headers };
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
  errors?: { message?: string; code?: string | number }[];
}

/** An error answer from X, with its HTTP status. */
export class XApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The raw `Retry-After` header, when X sent one. */
    readonly retryAfter?: string,
    /** The error code in X's body, when it carried one. */
    readonly platformCode?: string,
  ) {
    super(message);
  }
}

/** The request itself failed: the fetch rejected, so X gave no answer. */
export class XNetworkError extends Error {}

function bodyCode(body: Body | undefined): string | undefined {
  const code = body?.error ?? body?.errors?.[0]?.code;
  return code === undefined ? undefined : String(code);
}

function failure(
  res: { status: number; body: Body | undefined; retryAfter?: string },
  why?: string,
) {
  return new XApiError(
    res.status,
    why ?? describe(res.status, res.body),
    res.retryAfter,
    bodyCode(res.body),
  );
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
  private readonly tokens: TokenCache;
  private refreshToken: string;
  private storedLoaded = false;
  /** A rotated token the store has not accepted yet; retried before any further call. */
  private unsaved: string | undefined;
  /** Tail of the chain that serialises credential store writes. */
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly opts: XAdapterOptions,
    now: () => number,
  ) {
    this.doFetch = opts.fetch ?? defaultFetch;
    this.base = opts.apiBase ?? DEFAULT_BASE;
    this.refreshToken = opts.refreshToken;
    this.tokens = createTokenCache({ fetchToken: () => this.doRefresh(), now });
  }

  /** Exchange the refresh token for an access token, and keep the rotated refresh token. Concurrent callers share one request. */
  refresh(): Promise<string> {
    return this.tokens.get({ force: true });
  }

  private get credentialKey(): string {
    return this.opts.credentialKey ?? `x-refresh-token:${this.opts.userId}`;
  }

  /** The saved refresh token, when there is one, wins over the configured one. Read once. */
  private async loadStored(): Promise<void> {
    const store = this.opts.credentialStore;
    if (store === undefined || this.storedLoaded) return;
    const stored = await store.get(this.credentialKey);
    this.storedLoaded = true;
    if (stored !== undefined) this.refreshToken = stored;
  }

  private async persist(token: string): Promise<void> {
    this.refreshToken = token;
    this.unsaved = this.opts.credentialStore === undefined ? undefined : token;
    try {
      await this.retryUnsaved();
    } finally {
      await this.opts.onRefreshToken?.(token);
    }
  }

  /**
   * Write the unsaved token. Every store write goes through one chain, so writes happen in order,
   * and a write of a token that a newer rotation replaced is dropped.
   */
  private retryUnsaved(): Promise<void> {
    const token = this.unsaved;
    if (token === undefined) return Promise.resolve();
    const job = this.writes.then(async () => {
      if (this.unsaved !== token) return;
      await this.opts.credentialStore?.set(this.credentialKey, token);
      if (this.unsaved === token) this.unsaved = undefined;
    });
    this.writes = job.catch(() => {});
    return job;
  }

  private async doRefresh(): Promise<{ value: string; expiresInS?: number }> {
    await this.loadStored();
    await this.retryUnsaved();
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString("base64");
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_id: this.opts.clientId,
    });
    const res = await this.request(
      "POST",
      "/2/oauth2/token",
      {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      form.toString(),
    );
    const { body } = res;
    if (res.status !== 200 || !body?.access_token) throw failure(res);
    if (body.refresh_token && body.refresh_token !== this.refreshToken) {
      await this.persist(body.refresh_token);
    }
    return { value: body.access_token, expiresInS: body.expires_in };
  }

  private async userToken(): Promise<string> {
    await this.retryUnsaved();
    return this.tokens.get();
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
      throw failure(res);
    }
    return data.id;
  }

  private async get(path: string, token: string): Promise<XPage> {
    const res = await this.request("GET", path, { Authorization: `Bearer ${token}` });
    const { status, body } = res;
    if (status !== 200 || body === undefined) throw failure(res);
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
  ): Promise<{ status: number; body: Body | undefined; retryAfter?: string }> {
    let status: number;
    let text: string;
    let retryAfter: string | undefined;
    try {
      const res = await this.doFetch(this.base + path, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
      });
      status = res.status;
      retryAfter = res.headers?.get("retry-after") ?? undefined;
      text = await res.text();
    } catch (err) {
      throw new XNetworkError(err instanceof Error ? err.message : String(err));
    }
    const meta = retryAfter === undefined ? {} : { retryAfter };
    try {
      return { status, body: JSON.parse(text) as Body, ...meta };
    } catch {
      return { status, body: undefined, ...meta };
    }
  }
}
