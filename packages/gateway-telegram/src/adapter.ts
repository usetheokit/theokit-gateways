/**
 * `TelegramAdapter` — wraps grammy in the `@theokit/gateway`
 * `BasePlatformAdapter` contract (T5.1, ADR D171).
 *
 * - `connect()` calls `bot.start()` in the background; never throws on
 *   bad token (EC-I — returns `false`).
 * - `sendMessage` auto-splits text >4096 chars via `splitForTelegram`.
 * - Bot-to-bot loops blocked at the adapter (`ctx.from.is_bot === true`
 *   never reaches the handler) — EC-K.
 * - `normalizeEvent` produces a `TelegramMessageEvent` keyed by
 *   chat/message/thread ids.
 *
 * @public
 */

import type { MessageEvent as GatewayMessageEvent, TelegramMessageEvent } from "@theokit/gateway";
import { BasePlatformAdapter, type OutboundMessage, type SendResult } from "@theokit/gateway";
import { Bot, type Context, GrammyError, HttpError } from "grammy";
import { buildEvent } from "./parse-inbound.js";
import { splitForTelegram } from "./split.js";

export interface TelegramAdapterOptions {
  /**
   * The Telegram bot token.
   *
   * @platform-term Telegram calls this a **bot token** and `grammy` names the field `token`, so the
   * name here is theirs.
   * @issued-at BotFather, in Telegram itself, when the bot is created or its token regenerated.
   */
  readonly token: string;
  /** Optional allow-list filter applied at the adapter level. */
  readonly allowedUsers?: ReadonlyArray<string>;
}

/**
 * Telegram gateway adapter — long-polls for updates, so inbound needs no public URL.
 *
 * Two platform rules shape what this can do, and neither has a workaround: a bot cannot enumerate
 * the chats it belongs to, and it cannot speak into a chat that has not spoken to it first. A chat
 * id therefore has to come from an inbound message, never from the token.
 */
export class TelegramAdapter extends BasePlatformAdapter {
  readonly platform = "telegram" as const;
  private readonly bot: Bot;
  private readonly allowedUsers: Set<string>;
  private handler?: (event: GatewayMessageEvent) => Promise<void>;
  private connected = false;
  private startPromise?: Promise<void>;

  constructor(opts: TelegramAdapterOptions) {
    super();
    this.bot = new Bot(opts.token);
    this.allowedUsers = new Set(opts.allowedUsers ?? []);
    this.bot.on("message", async (ctx) => this.handleInbound(ctx));
    this.bot.catch((err) => {
      process.stderr.write(`[telegram] bot error: ${(err.error as Error)?.message ?? err}\n`);
    });
  }

  /**
   * Expose the underlying grammy `Bot` so consumers can register
   * grammy-specific event handlers that don't fit the portable
   * contract — `callbackQuery`, `bot.on(":voice")`, `bot.command(...)`,
   * etc. Register BEFORE calling `runner.start()`.
   *
   * @public
   */
  getBot(): Bot {
    return this.bot;
  }

  override async connect(): Promise<boolean> {
    if (this.connected) return true;
    try {
      await this.bot.init();
    } catch (err) {
      // EC-I: invalid token → return false, never throw.
      process.stderr.write(`[telegram] connect failed: ${(err as Error).message}\n`);
      return false;
    }
    this.startPromise = this.bot.start({ drop_pending_updates: true }).catch((err) => {
      process.stderr.write(`[telegram] polling stopped: ${(err as Error).message}\n`);
    });
    this.connected = true;
    return true;
  }

  override async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    try {
      await this.bot.stop();
    } catch (cause) {
      // PV#7 / T8.1 of arch-review-fixes-2026-06-06: disconnect must remain
      // idempotent + safe (catch is intentional — bot may already be torn down
      // by Telegram or by a prior signal handler). The empty-swallow violated
      // Unbreakable Rule 8 by hiding the diagnostic. Emit a structured stderr
      // message including the underlying error while preserving the
      // never-throw contract callers depend on.
      const message = cause instanceof Error ? cause.message : String(cause);
      process.stderr.write(
        `[theokit-gateway-telegram] bot.stop() failed during disconnect: ${message}\n`,
      );
    }
    if (this.startPromise !== undefined) {
      await this.startPromise.catch(() => undefined);
      this.startPromise = undefined;
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: validation + parse_mode mapping + thread option + chunk loop + error mapping are all single-responsibility branches inline; splitting hurts readability more than the score.
  override async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "text is empty" } };
    }
    const chatIdNum = Number(out.channel.id);
    if (Number.isNaN(chatIdNum)) {
      return {
        ok: false,
        error: { code: "invalid_channel", message: `channel.id "${out.channel.id}" not numeric` },
      };
    }
    const parseMode = mapFormat(out.format);
    const threadId = out.channel.topicId !== undefined ? Number(out.channel.topicId) : undefined;
    const chunks = splitForTelegram(out.text);
    let lastId: string | undefined;
    for (const chunk of chunks) {
      try {
        const msg = await this.bot.api.sendMessage(chatIdNum, chunk, {
          ...(parseMode !== undefined ? { parse_mode: parseMode } : {}),
          ...(threadId !== undefined ? { message_thread_id: threadId } : {}),
          ...(out.replyTo !== undefined
            ? { reply_parameters: { message_id: Number(out.replyTo) } }
            : {}),
        });
        lastId = String(msg.message_id);
      } catch (err) {
        return mapSendError(err);
      }
    }
    return { ok: true, ...(lastId !== undefined ? { messageId: lastId } : {}) };
  }

  override onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    // EC-H: replace previous handler (do not stack).
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = undefined;
    };
  }

  override async startTyping(channelId: string): Promise<void> {
    const chatId = Number(channelId);
    if (Number.isNaN(chatId)) return;
    try {
      await this.bot.api.sendChatAction(chatId, "typing");
    } catch {
      /* cosmetic — swallow (EC-O) */
    }
  }

  private async handleInbound(ctx: Context): Promise<void> {
    if (this.handler === undefined) return;
    // EC-K: ignore messages from other bots.
    if (ctx.from?.is_bot === true) return;
    if (this.allowedUsers.size > 0) {
      const senderId = String(ctx.from?.id ?? "");
      if (!this.allowedUsers.has(senderId)) return;
    }
    const event = normalizeEvent(ctx);
    if (event === undefined) return;
    await this.dispatchEvent(event);
  }

  /**
   * Dispatch a pre-built event to the current handler, honouring EC-H replace
   * semantics.
   *
   * Mirrors the seam `gateway-sms` already exposes. It exists because the EC-H
   * contract had no honest test without it: a grammy `Context` cannot be
   * synthesized here, `handler` is private, and the test that claimed to cover
   * replacement asserted an empty array — true whether onInbound replaces,
   * stacks, or discards.
   *
   * @internal
   */
  async dispatchEvent(event: GatewayMessageEvent): Promise<"ok" | "no_handler" | "handler_threw"> {
    if (this.handler === undefined) return "no_handler";
    try {
      await this.handler(event);
    } catch (err) {
      // Left uncaught, the rejection escaped into the platform's own error channel and was reported
      // as a client error — so a bug in the consumer's handler read as a fault in the platform
      // library, sending whoever debugged it to the wrong repository (#41). A handler is user code:
      // its failure is named as such, and delivery continues.
      const m = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[telegram] handler threw: ${m}\n`);
      return "handler_threw";
    }
    return "ok";
  }
}

/**
 * Adapt grammy's `Context` to the shared mapping in `parse-inbound.ts`.
 *
 * The mapping itself is NOT here: a polled update and a webhook-delivered one must produce the
 * same event, and the only way to guarantee that is for one function to build both.
 */
function normalizeEvent(ctx: Context): TelegramMessageEvent | undefined {
  const chat = ctx.chat;
  const msg = ctx.message;
  if (chat === undefined || msg === undefined) return undefined;

  return buildEvent(chat, msg, ctx.from, ctx);
}

function mapFormat(
  format: "plain" | "markdown" | "html" | undefined,
): "Markdown" | "HTML" | undefined {
  if (format === "markdown") return "Markdown";
  if (format === "html") return "HTML";
  return undefined;
}

function mapSendError(err: unknown): SendResult {
  if (err instanceof GrammyError) {
    const description = err.description.toLowerCase();
    if (description.includes("rate limit") || err.error_code === 429) {
      return { ok: false, error: { code: "rate_limited", message: err.description } };
    }
    if (description.includes("forbidden") || err.error_code === 403) {
      return { ok: false, error: { code: "no_permission", message: err.description } };
    }
    if (description.includes("parse")) {
      return { ok: false, error: { code: "markdown_error", message: err.description } };
    }
    return {
      ok: false,
      error: { code: `telegram_${err.error_code}`, message: err.description },
    };
  }
  if (err instanceof HttpError) {
    return { ok: false, error: { code: "network_error", message: err.message } };
  }
  return { ok: false, error: { code: "unknown", message: (err as Error).message } };
}
