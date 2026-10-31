/**
 * `SynologyChatAdapter` — `BasePlatformAdapter` over a Synology Chat bot: outgoing callbacks on
 * the adapter's own listener, replies through the bot's Incoming URL.
 *
 * @public
 */

import {
  BasePlatformAdapter,
  channelRendering,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
} from "@theokit/gateway";

import { type ChatAnswer, SynologyChatClient } from "./client.js";
import { refuseAttachments } from "./refuse-attachments.js";
import { SeenIds } from "./seen-ids.js";
import { tokensMatch } from "./token.js";
import {
  type FetchLike,
  type SynologyChatAdapterOptions,
  SynologyChatConfigError,
} from "./types.js";
import {
  createWebhookServer,
  type SynologyChatInbound,
  type WebhookServer,
} from "./webhook-server.js";

const LABEL = "gateway-synology-chat";
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const SEND_TIMEOUT_MS = 30_000;
const DIGITS = /^\d+$/;

type CallbackAnswer = { readonly status: number; readonly body: Record<string, unknown> };

/**
 * Synology Chat adapter for one bot.
 *
 * `connect()` calls `user_list` through the Incoming URL, which proves the URL and its token, and
 * starts the callback listener; it answers `false`, never a throw, when the NAS refuses, does not
 * answer within `connectTimeoutMs`, or the port is taken. A callback must carry the bot token (401
 * otherwise), and becomes one `SynologyChatMessageEvent`; a `post_id` already delivered is
 * answered 200 and not delivered again. A reply goes to the user who wrote, as `user_ids: [id]`.
 *
 * @public
 */
export class SynologyChatAdapter extends BasePlatformAdapter implements SynologyChatInbound {
  readonly platform = "synology_chat" as const;
  private readonly opts: SynologyChatAdapterOptions;
  private readonly client: SynologyChatClient;
  private readonly seen = new SeenIds();
  private server: WebhookServer | undefined;
  private handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private connected = false;
  private connecting: Promise<boolean> | undefined;
  /** Bumped by `disconnect()`, so a connect that was overtaken by one gives up its listener. */
  private generation = 0;
  private warnedAboutHtml = false;

  /**
   * @throws SynologyChatConfigError when `botToken` is empty (any callback with an empty token
   *   would match it) or `incomingUrl` is not an http(s) URL with a `token` parameter
   */
  constructor(opts: SynologyChatAdapterOptions) {
    super();
    if (opts.botToken.length === 0) {
      throw new SynologyChatConfigError(`${LABEL}: botToken is empty`);
    }
    if (!isIncomingUrl(opts.incomingUrl)) {
      throw new SynologyChatConfigError(
        `${LABEL}: incomingUrl must be the bot's http(s) Incoming URL with its token parameter`,
      );
    }
    this.opts = opts;
    const fetchFn: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
    this.client = new SynologyChatClient(opts.incomingUrl, fetchFn);
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    // A second caller shares the first one's answer instead of starting a second listener.
    if (this.connecting !== undefined) return this.connecting;
    const attempt = this.openSession().finally(() => {
      if (this.connecting === attempt) this.connecting = undefined;
    });
    this.connecting = attempt;
    return attempt;
  }

  async disconnect(): Promise<void> {
    this.generation += 1;
    this.connected = false;
    this.connecting = undefined;
    const server = this.server;
    this.server = undefined;
    await server?.stop();
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
        error: {
          code: "not_connected",
          message: "SynologyChatAdapter.connect() has not succeeded",
        },
      };
    }
    if (!DIGITS.test(out.channel.id)) {
      return {
        ok: false,
        error: {
          code: "invalid_channel",
          message: `channel.id must be the user's numeric id, got ${JSON.stringify(out.channel.id)}`,
        },
      };
    }
    const answer = await withTimeout(SEND_TIMEOUT_MS, (signal) =>
      this.client.post(Number(out.channel.id), this.textFor(out), signal),
    );
    if (answer === "timeout") {
      return {
        ok: false,
        error: { code: "timeout", message: `the NAS did not answer within ${SEND_TIMEOUT_MS} ms` },
      };
    }
    if (answer.ok) return { ok: true };
    return { ok: false, error: { code: "synology_api_error", message: answer.reason } };
  }

  onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    // Replace, not stack.
    this.handler = handler;
    return () => {
      if (this.handler === handler) {
        this.handler = undefined;
      }
    };
  }

  /** Deliver an event that arrived out of band, through `runHandler`. */
  override async deliver(
    event: GatewayMessageEvent,
  ): Promise<"ok" | "no_handler" | "handler_threw"> {
    return this.runHandler(this.handler, event);
  }

  /**
   * Answer one outgoing callback. The token is checked before anything else is read: missing or
   * empty is 400, wrong is 401. A callback with no handler subscribed is 503, so the NAS does not
   * count it as taken.
   */
  async handleCallback(contentType: string | undefined, rawBody: string): Promise<CallbackAnswer> {
    const callback = readCallback(this.opts.botToken, parseFields(contentType, rawBody));
    if ("status" in callback) return callback;
    const { fields, userId, text, postId } = callback;
    if (postId !== undefined && this.seen.has(postId)) return { status: 200, body: {} };
    if (!this.connected || this.handler === undefined) {
      return { status: 503, body: { error: "no handler" } };
    }
    if (postId !== undefined) this.seen.add(postId);
    void this.deliver(toMessageEvent(fields, userId, text)).catch((err: unknown) => {
      process.stderr.write(`[${LABEL}] handler threw: ${messageOf(err)}\n`);
    });
    return { status: 200, body: {} };
  }

  /** The text to send: markdown loses its markers, html goes as is with one warning. */
  private textFor(out: OutboundMessage): string {
    if (out.format === "markdown") return channelRendering(this.platform).translate(out.text);
    if (out.format === "html" && !this.warnedAboutHtml) {
      this.warnedAboutHtml = true;
      process.stderr.write(
        `[${LABEL}] format="html" was declared and a Synology Chat bot message is plain text; sending the text unchanged. Logged once.\n`,
      );
    }
    return out.text;
  }

  /**
   * Prove the Incoming URL, then start the listener. A `disconnect()` that lands while either is
   * pending wins: the listener is stopped again and the answer is `false`.
   */
  private async openSession(): Promise<boolean> {
    const generation = this.generation;
    const timeoutMs = this.opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const listed = await withTimeout(timeoutMs, (signal) => this.client.userList(signal));
    if (!usable(listed, timeoutMs)) return false;
    if (generation !== this.generation) return false;
    let server: WebhookServer;
    try {
      server = await createWebhookServer({
        adapter: this,
        ...(this.opts.path === undefined ? {} : { path: this.opts.path }),
        ...(this.opts.port === undefined ? {} : { port: this.opts.port }),
        ...(this.opts.app === undefined ? {} : { app: this.opts.app }),
      });
      await server.start();
    } catch (err) {
      process.stderr.write(
        `[${LABEL}] connect failed: listener did not start: ${messageOf(err)}\n`,
      );
      return false;
    }
    if (generation !== this.generation) {
      await server.stop();
      return false;
    }
    this.server = server;
    this.connected = true;
    return true;
  }
}

/** A callback whose token matched, with the fields the event is built from. */
interface ReadCallback {
  readonly fields: Map<string, string>;
  readonly userId: number;
  readonly text: string;
  /** Absent or empty `post_id` reads as `undefined`, so it never enters the seen-id set (EC-10). */
  readonly postId: string | undefined;
}

/** Check the token first, then the fields; an answer to send back when either fails. */
function readCallback(
  botToken: string,
  fields: Map<string, string>,
): ReadCallback | CallbackAnswer {
  const token = fields.get("token") ?? "";
  // Two empty buffers compare equal, so an empty token is refused before any comparison (EC-3).
  if (token.length === 0) return { status: 400, body: { error: "missing token" } };
  if (!tokensMatch(botToken, token)) {
    process.stderr.write(`[${LABEL}] refused a callback (401): wrong token\n`);
    return { status: 401, body: { error: "invalid token" } };
  }
  const userId = fields.get("user_id") ?? "";
  const text = fields.get("text");
  if (!DIGITS.test(userId) || text === undefined) {
    return { status: 400, body: { error: "user_id must be digits and text must be present" } };
  }
  const postId = fields.get("post_id");
  return { fields, userId: Number(userId), text, postId: postId === "" ? undefined : postId };
}

function usable(listed: ChatAnswer | "timeout", timeoutMs: number): boolean {
  if (listed === "timeout") {
    process.stderr.write(`[${LABEL}] connect failed: no user_list answer within ${timeoutMs} ms\n`);
    return false;
  }
  if (!listed.ok) {
    process.stderr.write(`[${LABEL}] connect failed: ${listed.reason}\n`);
    return false;
  }
  return true;
}

function isIncomingUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && url.searchParams.has("token");
  } catch {
    return false;
  }
}

/** The callback's fields, from a form body or a JSON one (plan Q3). */
function parseFields(contentType: string | undefined, rawBody: string): Map<string, string> {
  if (contentType?.includes("application/json") === true) {
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (typeof parsed !== "object" || parsed === null) return new Map();
      return new Map(
        Object.entries(parsed).map(([key, value]) => [
          key,
          typeof value === "string" ? value : String(value),
        ]),
      );
    } catch {
      // Not JSON: no token is read from it, so the callback is answered 400.
      return new Map();
    }
  }
  return new Map(new URLSearchParams(rawBody));
}

function toMessageEvent(
  fields: Map<string, string>,
  userId: number,
  text: string,
): GatewayMessageEvent {
  const postId = fields.get("post_id") ?? "";
  const receivedAt = Date.now();
  const stated = fields.get("timestamp") ?? "";
  const timestamp = DIGITS.test(stated) ? Number(stated) : receivedAt;
  const username = fields.get("username") ?? "";
  return {
    id: postId === "" ? `${userId}-${timestamp}` : postId,
    platform: "synology_chat",
    sender: { id: String(userId), username },
    channel: { id: String(userId), type: "dm" },
    text,
    receivedAt,
    synology_chat: {
      userId,
      username,
      postId,
      timestamp,
      raw: Object.fromEntries([...fields].filter(([key]) => key !== "token")),
    },
  };
}

/** Run `work` with an abort signal; `"timeout"` once `ms` passes first, after aborting it. */
async function withTimeout<T>(
  ms: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T | "timeout"> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
