/**
 * `XAdapter` — `BasePlatformAdapter` over X (Twitter): mentions of the bot account are polled
 * from the X API v2 and become thread conversations; replies are posted as public replies.
 *
 * @public
 */

import {
  BasePlatformAdapter,
  channelRendering,
  chunkByGrapheme,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
  type XThreadTweet,
} from "@theokit/gateway";

import { XAccessPolicy } from "./allow.js";
import { XApi, type XPage } from "./api.js";
import { refuseAttachments } from "./refuse-attachments.js";
import type { XAdapterOptions, XTweet, XUser } from "./types.js";

/** The most characters one post carries here (the standard, non-premium limit). */
export const X_POST_LIMIT = 280;
const LABEL = "gateway-x";
const DEFAULT_POLL_MS = 60_000;
const DEFAULT_DEPTH = 5;
const MEMORY = 1000;

/** Split `text` into posts of at most 280 characters, never inside a grapheme. @public */
export function splitForX(text: string): string[] {
  return chunkByGrapheme(text, { limit: X_POST_LIMIT }).filter((part) => part !== "");
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function remember<T>(set: Set<T>, value: T): void {
  set.add(value);
  if (set.size > MEMORY) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) set.delete(oldest);
  }
}

/** Numeric ids compare by length, then lexically; X ids grow with time. */
function newer(a: string, b: string | undefined): boolean {
  if (b === undefined) return true;
  return a.length !== b.length ? a.length > b.length : a > b;
}

/**
 * X (Twitter) adapter for one bot account.
 *
 * `connect()` refreshes the OAuth 2.0 token and notes the newest existing mention, so the backlog
 * is not answered; it answers `true` or `false`, never a throw. Then the mentions of the account
 * are polled every `pollIntervalMs` (or by calling `poll()`). A mention from an allowlisted author
 * (or, with `guest`, from another author under their daily cap) becomes one group-thread event
 * whose channel is the conversation, with the tweets it replies to and the tweet it quotes in
 * `event.x`. A mention from anyone else is dropped: no event, no reply. A reply goes out as a
 * public reply to the latest mention of that conversation, split at 280 characters into a chain.
 * There are no DMs, likes or media uploads.
 *
 * @public
 */
export class XAdapter extends BasePlatformAdapter {
  readonly platform = "x" as const;
  private readonly opts: XAdapterOptions;
  private readonly api: XApi;
  private readonly policy: XAccessPolicy;
  private readonly now: () => number;
  private readonly botHandle: string;
  private handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private connected = false;
  private sinceId: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private polling = false;
  private readonly seen = new Set<string>();
  /** Mention tweets that were delivered; the only tweets a reply may go to. */
  private readonly answerable = new Set<string>();
  /** The latest delivered mention of each conversation: where `sendMessage` replies. */
  private readonly latest = new Map<string, string>();

  /** @throws Error when a credential, `userId`, `username` or `allowFrom` is missing */
  constructor(opts: XAdapterOptions) {
    super();
    for (const key of ["userId", "username", "clientId", "clientSecret", "refreshToken"] as const) {
      if (typeof opts[key] !== "string" || opts[key] === "") {
        throw new Error(`${LABEL}: opts.${key} is required`);
      }
    }
    if (!Array.isArray(opts.allowFrom)) throw new Error(`${LABEL}: opts.allowFrom is required`);
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.api = new XApi(opts, this.now);
    this.policy = new XAccessPolicy(opts.allowFrom, opts.guest);
    this.botHandle = opts.username.replace(/^@/, "").toLowerCase();
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    try {
      await this.api.refresh();
      const page = await this.api.mentions(undefined, 5);
      this.sinceId = page.newestId ?? this.sinceId;
    } catch (err) {
      process.stderr.write(`[${LABEL}] connect failed: ${messageOf(err)}\n`);
      return false;
    }
    this.connected = true;
    this.schedule();
    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    const every = this.opts.pollIntervalMs ?? DEFAULT_POLL_MS;
    if (!this.connected || every <= 0) return;
    this.timer = setTimeout(() => {
      void this.poll()
        .catch(() => undefined)
        .finally(() => this.schedule());
    }, every);
    this.timer.unref?.();
  }

  /**
   * Read the mentions newer than the last one seen and deliver the ones this adapter answers.
   * The timer calls it; call it yourself when `pollIntervalMs` is `0`. Never throws.
   *
   * @returns how many events were delivered
   */
  async poll(): Promise<number> {
    if (!this.connected || this.polling) return 0;
    this.polling = true;
    let delivered = 0;
    try {
      const page = await this.api.mentions(this.sinceId, 100);
      for (const tweet of page.tweets) {
        if (await this.dispatch(tweet, page)) delivered += 1;
      }
      if (page.newestId !== undefined && newer(page.newestId, this.sinceId)) {
        this.sinceId = page.newestId;
      }
    } catch (err) {
      process.stderr.write(`[${LABEL}] poll failed: ${messageOf(err)}\n`);
    } finally {
      this.polling = false;
    }
    return delivered;
  }

  private async dispatch(tweet: XTweet, page: XPage): Promise<boolean> {
    const authorId = tweet.author_id ?? "";
    if (authorId === "" || authorId === this.opts.userId || this.seen.has(tweet.id)) return false;
    remember(this.seen, tweet.id);
    const username = page.users.get(authorId)?.username ?? "";
    const verdict = this.policy.decide(authorId, username, this.now());
    if (verdict === "refused") return false;
    const event = await this.toEvent(tweet, page, username, verdict === "guest");
    const conversationId = event.channel.id;
    remember(this.answerable, tweet.id);
    this.latest.set(conversationId, tweet.id);
    if (this.latest.size > MEMORY) {
      const oldest = this.latest.keys().next().value;
      if (oldest !== undefined) this.latest.delete(oldest);
    }
    if ((await this.deliver(event)) === "handler_threw") {
      process.stderr.write(`[${LABEL}] handler threw\n`);
    }
    return true;
  }

  private async toEvent(
    tweet: XTweet,
    page: XPage,
    username: string,
    guest: boolean,
  ): Promise<GatewayMessageEvent> {
    const authorId = tweet.author_id ?? "";
    const { thread, quoted } = await this.context(tweet, page);
    const conversationId = tweet.conversation_id ?? tweet.id;
    const created = Date.parse(tweet.created_at ?? "");
    const event = {
      id: tweet.id,
      platform: "x",
      sender: { id: authorId, ...(username === "" ? {} : { username }) },
      channel: { id: conversationId, type: "group" },
      text: this.stripHandles(tweet.text ?? ""),
      receivedAt: Number.isNaN(created) ? this.now() : created,
      ...(thread.length === 0 ? {} : { replyTo: thread[thread.length - 1]?.tweetId }),
      x: {
        tweetId: tweet.id,
        conversationId,
        authorId,
        thread,
        ...(quoted === undefined ? {} : { quoted }),
        guest,
        raw: tweet,
      },
    } as GatewayMessageEvent;
    return event;
  }

  /** The tweets the mention replies to (oldest first) and the one it quotes. */
  private async context(
    tweet: XTweet,
    page: XPage,
  ): Promise<{ thread: XThreadTweet[]; quoted: XThreadTweet | undefined }> {
    const depth = this.opts.maxThreadDepth ?? DEFAULT_DEPTH;
    const known = new Map<string, XUser>(page.users);
    const lookup = async (id: string): Promise<XTweet | undefined> => {
      const hit = page.included.get(id);
      if (hit !== undefined) return hit;
      try {
        const got = await this.api.tweet(id);
        for (const [uid, user] of got?.users ?? []) known.set(uid, user);
        return got?.tweet;
      } catch (err) {
        process.stderr.write(`[${LABEL}] thread lookup failed: ${messageOf(err)}\n`);
        return undefined;
      }
    };
    const shape = (t: XTweet): XThreadTweet => ({
      tweetId: t.id,
      authorId: t.author_id ?? "",
      username: known.get(t.author_id ?? "")?.username ?? "",
      text: t.text ?? "",
    });
    const refOf = (t: XTweet, type: string): string | undefined =>
      t.referenced_tweets?.find((r) => r.type === type)?.id;

    const thread: XThreadTweet[] = [];
    let parentId = refOf(tweet, "replied_to");
    while (parentId !== undefined && thread.length < depth) {
      const parent = await lookup(parentId);
      if (parent === undefined) break;
      thread.unshift(shape(parent));
      parentId = refOf(parent, "replied_to");
    }
    const quotedId = refOf(tweet, "quoted");
    const quotedTweet = quotedId === undefined ? undefined : await lookup(quotedId);
    return { thread, quoted: quotedTweet === undefined ? undefined : shape(quotedTweet) };
  }

  /** Drop the handles X puts in front of a reply, the bot's own among them. */
  private stripHandles(text: string): string {
    const stripped = text.replace(/^(?:\s*@\w{1,15})+\s*/, "");
    return stripped === "" && text.toLowerCase().includes(`@${this.botHandle}`) ? "" : stripped;
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    return refuseAttachments(out) ?? this.sendText(out);
  }

  private async sendText(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "outbound text is empty" } };
    }
    if (!this.connected) {
      return {
        ok: false,
        error: { code: "not_connected", message: "XAdapter.connect() has not succeeded" },
      };
    }
    let target = out.replyTo ?? this.latest.get(out.channel.id);
    if (target === undefined || !this.answerable.has(target)) {
      return {
        ok: false,
        error: {
          code: "invalid_reply_target",
          message: "X replies only go to a mention this adapter delivered",
        },
      };
    }
    const text =
      out.format === "markdown" ? channelRendering(this.platform).translate(out.text) : out.text;
    let messageId = "";
    try {
      for (const part of splitForX(text)) {
        messageId = await this.api.reply(part, target);
        target = messageId;
      }
    } catch (err) {
      return { ok: false, error: { code: "x_send_failed", message: messageOf(err) } };
    }
    return { ok: true, messageId };
  }

  onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = undefined;
    };
  }

  override async deliver(
    event: GatewayMessageEvent,
  ): Promise<"ok" | "no_handler" | "handler_threw"> {
    return this.runHandler(this.handler, event);
  }
}
