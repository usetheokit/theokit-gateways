/**
 * `NextcloudTalkAdapter` — `BasePlatformAdapter` over a Nextcloud Talk bot: signed webhooks in,
 * signed bot messages out.
 *
 * @public
 */

import { randomBytes } from "node:crypto";

import {
  BasePlatformAdapter,
  channelRendering,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
} from "@theokit/gateway";

import { type TalkWebhookBody, talkBodyToMessageEvent } from "./normalize.js";
import { talkSignature, verifyTalkSignature } from "./signature.js";
import { splitForTalk } from "./split.js";
import type { FetchLike, NextcloudTalkAdapterOptions } from "./types.js";
import { createWebhookServer, type WebhookServer } from "./webhook-server.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const LABEL = "gateway-nextcloud-talk";
/** Talk room tokens are short alphanumeric strings; anything else could change the request path. */
const ROOM_TOKEN = /^[A-Za-z0-9]+$/;
/** The `spreed` feature that says the server has bots and their webhook. */
const BOTS_FEATURE = "bots-v1";
/** The secret lengths `occ talk:bot:install` accepts. */
const MIN_SECRET = 40;
const MAX_SECRET = 128;

/** The two headers Talk signs a webhook with. */
export interface TalkSignatureHeaders {
  readonly random?: string | undefined;
  readonly signature?: string | undefined;
}

/** What the webhook route needs from the adapter: one answer per request. */
export interface NextcloudTalkInbound {
  handleRequest(
    headers: TalkSignatureHeaders,
    rawBody: string,
  ): Promise<{ readonly status: number; readonly body: Record<string, unknown> }>;
}

type FeatureRead =
  | { readonly ok: true; readonly features: readonly string[] }
  | {
      readonly ok: false;
      readonly reason: string;
    };

/**
 * Nextcloud Talk adapter for one bot.
 *
 * `connect()` reads the server's capabilities, requires the `bots-v1` feature of Talk (`spreed`)
 * and starts the webhook listener; it answers `false`, never a throw, when the server cannot be
 * read, lacks the feature, or does not answer within `connectTimeoutMs`. Each webhook must carry
 * Talk's signature over its random and its raw body (401 otherwise), and a message a person wrote
 * becomes a `NextcloudTalkMessageEvent`.
 *
 * @public
 */
export class NextcloudTalkAdapter extends BasePlatformAdapter implements NextcloudTalkInbound {
  readonly platform = "nextcloud_talk" as const;
  private readonly opts: NextcloudTalkAdapterOptions;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private server: WebhookServer | undefined;
  private handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private connected = false;
  private connecting: Promise<boolean> | undefined;
  /** Bumped by `disconnect()`, so a connect that was overtaken by one gives up its listener. */
  private generation = 0;
  private warnedAboutHtml = false;

  /**
   * @throws Error when `secret` is outside the 40 to 128 characters Talk accepts. An empty secret
   *   in particular would let anyone sign a webhook, and only outbound sends would notice.
   */
  constructor(opts: NextcloudTalkAdapterOptions) {
    super();
    if (opts.secret.length < MIN_SECRET || opts.secret.length > MAX_SECRET) {
      throw new Error(
        `${LABEL}: opts.secret must be 40 to 128 characters, as occ talk:bot:install requires; got ${opts.secret.length}`,
      );
    }
    this.opts = opts;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    // A second caller while the first is still connecting shares its answer instead of reading
    // the capabilities again and starting a second listener on the same port.
    if (this.connecting !== undefined) return this.connecting;
    const attempt = this.openSession().finally(() => {
      // Only clear what is still ours: `disconnect()` clears the slot too, and a `connect()` made
      // after it may already hold its own attempt there.
      if (this.connecting === attempt) this.connecting = undefined;
    });
    this.connecting = attempt;
    return attempt;
  }

  async disconnect(): Promise<void> {
    this.generation += 1;
    this.connected = false;
    // The overtaken attempt still answers `false` to its own callers; a `connect()` from here on
    // starts a fresh session instead of inheriting that answer.
    this.connecting = undefined;
    const server = this.server;
    this.server = undefined;
    await server?.stop();
  }

  /**
   * Send `out.text` to the room `out.channel.id` as the bot. A text longer than 32000 code points
   * goes as consecutive messages, and the first refusal stops the rest. The `messageId` is the
   * `referenceId` of the first message, which Talk echoes back on the messages it stores.
   */
  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "outbound text is empty" } };
    }
    const room = out.channel.id;
    if (!ROOM_TOKEN.test(room)) {
      return {
        ok: false,
        error: {
          code: "invalid_room",
          message: `channel.id must be a Talk room token (letters and digits), got ${JSON.stringify(room)}`,
        },
      };
    }
    if (!this.connected) {
      return {
        ok: false,
        error: {
          code: "not_connected",
          message: "NextcloudTalkAdapter.connect() has not succeeded",
        },
      };
    }
    return this.sendParts(room, splitForTalk(this.textFor(out)));
  }

  /** Post each part in turn; the first refusal stops the rest and says which part it was. */
  private async sendParts(room: string, parts: readonly string[]): Promise<SendResult> {
    let first: string | undefined;
    for (const [index, part] of parts.entries()) {
      const result = await this.post(room, part);
      if (!result.ok) {
        if (parts.length === 1 || result.error === undefined) return result;
        // The earlier parts are already in the room; say which one failed.
        const where = `part ${index + 1} of ${parts.length}`;
        return {
          ok: false,
          error: { ...result.error, message: `${where}: ${result.error.message}` },
        };
      }
      first ??= result.messageId;
    }
    return first === undefined ? { ok: true } : { ok: true, messageId: first };
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

  /**
   * Deliver an event that arrived out of band. One line over `runHandler`, which owns the
   * containment of a throwing handler.
   */
  override async deliver(
    event: GatewayMessageEvent,
  ): Promise<"ok" | "no_handler" | "handler_threw"> {
    return this.runHandler(this.handler, event);
  }

  /**
   * Answer one webhook: check its signature, then hand a message a person wrote to the handler.
   * The handler runs after the answer, so a slow one never makes Talk wait.
   */
  async handleRequest(
    headers: TalkSignatureHeaders,
    rawBody: string,
  ): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
    if (!verifyTalkSignature(this.opts.secret, headers.random, rawBody, headers.signature)) {
      process.stderr.write(`[${LABEL}] refused a webhook (401): signature missing or wrong\n`);
      return { status: 401, body: { error: "invalid signature" } };
    }
    const body = parseObject(rawBody);
    if (body === undefined)
      return { status: 400, body: { error: "the body is not a JSON object" } };
    const outcome = talkBodyToMessageEvent(body, Date.now());
    if (outcome.kind === "unreadable") {
      process.stderr.write(`[${LABEL}] dropped a webhook: ${outcome.reason}\n`);
      return { status: 200, body: {} };
    }
    if (outcome.kind === "ignored") return { status: 200, body: {} };
    // No handler means nobody would see the message: a 503 tells Talk it was not taken.
    if (this.handler === undefined) return { status: 503, body: { error: "no handler" } };
    void this.deliver(outcome.event).catch((err: unknown) => {
      process.stderr.write(`[${LABEL}] handler threw: ${message(err)}\n`);
    });
    return { status: 200, body: {} };
  }

  /** The text to send: markdown passes through, html goes as is with one warning. */
  private textFor(out: OutboundMessage): string {
    if (out.format === "markdown") return channelRendering(this.platform).translate(out.text);
    if (out.format === "html" && !this.warnedAboutHtml) {
      this.warnedAboutHtml = true;
      process.stderr.write(
        `[${LABEL}] format="html" was declared and Talk has no html mode; sending the text unchanged. Logged once.\n`,
      );
    }
    return out.text;
  }

  /** One bot message, signed over a fresh random followed by the text. */
  private async post(room: string, text: string): Promise<SendResult> {
    const random = randomBytes(32).toString("hex");
    const referenceId = randomBytes(32).toString("hex");
    let response: Response;
    try {
      response = await this.fetchFn(
        `${this.baseUrl}/ocs/v2.php/apps/spreed/api/v1/bot/${room}/message`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            "ocs-apirequest": "true",
            "x-nextcloud-talk-bot-random": random,
            "x-nextcloud-talk-bot-signature": talkSignature(this.opts.secret, random, text),
          },
          body: JSON.stringify({ message: text, referenceId }),
        },
      );
    } catch (err) {
      return { ok: false, error: { code: "talk_http_error", message: message(err) } };
    }
    // The answer's body is not read; release the connection it holds.
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 201) return { ok: true, messageId: referenceId };
    return { ok: false, error: sendError(response.status) };
  }

  /**
   * Check the server has bots, then start the listener. A `disconnect()` that lands while either
   * is pending wins: the listener is stopped again and the answer is `false`.
   */
  private async openSession(): Promise<boolean> {
    const generation = this.generation;
    if (!(await this.serverHasBots())) return false;
    if (generation !== this.generation) return overtaken();
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
      process.stderr.write(`[${LABEL}] connect failed: listener did not start: ${message(err)}\n`);
      return false;
    }
    if (generation !== this.generation) {
      await server.stop();
      return overtaken();
    }
    this.server = server;
    this.connected = true;
    return true;
  }

  /** Whether the server's capabilities name `bots-v1`, read within `connectTimeoutMs`. */
  private async serverHasBots(): Promise<boolean> {
    const controller = new AbortController();
    const timeoutMs = this.opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<FeatureRead>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ ok: false, reason: `no capabilities answer within ${timeoutMs} ms` });
      }, timeoutMs);
    });
    try {
      const read = await Promise.race([this.readFeatures(controller.signal), deadline]);
      if (!read.ok) {
        process.stderr.write(`[${LABEL}] connect failed: ${read.reason}\n`);
        return false;
      }
      if (!read.features.includes(BOTS_FEATURE)) {
        process.stderr.write(
          `[${LABEL}] connect failed: the server's Talk has no "${BOTS_FEATURE}" feature\n`,
        );
        return false;
      }
      return true;
    } finally {
      clearTimeout(timer);
    }
  }

  /** The `spreed` features of the server. Never rejects: a failure is a `reason`. */
  private async readFeatures(signal: AbortSignal): Promise<FeatureRead> {
    try {
      const response = await this.fetchFn(
        `${this.baseUrl}/ocs/v2.php/cloud/capabilities?format=json`,
        {
          headers: { accept: "application/json", "ocs-apirequest": "true" },
          signal,
        },
      );
      if (!response.ok) {
        return { ok: false, reason: `capabilities answered HTTP ${response.status}` };
      }
      const answer = (await response.json()) as {
        ocs?: { data?: { capabilities?: { spreed?: { features?: unknown } } } };
      };
      const features = answer.ocs?.data?.capabilities?.spreed?.features;
      if (!Array.isArray(features)) {
        return { ok: false, reason: "the server reports no Talk (spreed) capabilities" };
      }
      return { ok: true, features: features.filter((f): f is string => typeof f === "string") };
    } catch (err) {
      return { ok: false, reason: `capabilities could not be read: ${message(err)}` };
    }
  }
}

/** The SendResult error for a non-201 answer to a bot message. */
function sendError(status: number): { code: string; message: string } {
  if (status === 401) {
    return {
      code: "talk_unauthorized",
      message:
        "Talk refused the bot's signature (401): check that secret matches the installed bot",
    };
  }
  if (status === 400) {
    return {
      code: "talk_bad_request",
      message: "Talk refused the message (400): the room may not exist or the bot is not in it",
    };
  }
  return { code: "talk_http_error", message: `Talk answered HTTP ${status}` };
}

function parseObject(rawBody: string): TalkWebhookBody | undefined {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as TalkWebhookBody)
      : undefined;
  } catch {
    return undefined;
  }
}

function overtaken(): false {
  process.stderr.write(
    `[${LABEL}] connect failed: disconnect() was called before connect finished\n`,
  );
  return false;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
