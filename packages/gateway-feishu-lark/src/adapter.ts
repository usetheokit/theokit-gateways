/**
 * `FeishuLarkAdapter` — `BasePlatformAdapter` over the Feishu/Lark open platform: events from the
 * SDK's long connection, replies through `im.message.create` and `im.message.reply`.
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

import { normalizeLarkMessage } from "./normalize.js";
import { SeenIds } from "./seen-ids.js";
import { createLarkTransport } from "./transport.js";
import type { FeishuLarkAdapterOptions, LarkApiResult, LarkTransport } from "./types.js";

const LABEL = "gateway-feishu-lark";
const CONNECT_TIMEOUT_MS = 10_000;
const SEND_TIMEOUT_MS = 30_000;
const APP_ID = /^cli_[0-9a-fA-F]{16}$/;

/**
 * Feishu/Lark adapter for one custom app.
 *
 * `connect()` fetches a tenant access token, which proves the App ID and Secret, then opens the
 * long connection; it answers `false`, never a throw, when either fails or 10000 ms pass. Each
 * `im.message.receive_v1` text message from a user becomes a `FeishuLarkMessageEvent` once (the
 * last 1000 event ids are remembered, so Lark's redelivery is not answered twice), delivered after
 * the dispatcher has returned, so the SDK acknowledges it inside Lark's window. The SDK's own
 * reconnect stays on; when it gives up, the adapter logs one line and reads as disconnected (D7).
 *
 * @public
 */
export class FeishuLarkAdapter extends BasePlatformAdapter {
  readonly platform = "feishu_lark" as const;
  private readonly transport: LarkTransport;
  private readonly seen = new SeenIds();
  private handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private connected = false;
  private connecting: Promise<boolean> | undefined;
  private warnedAboutHtml = false;
  /** Bumped by every `disconnect()` and every connect that gave up, so a late answer is dropped. */
  private generation = 0;

  /** @throws Error when `appId` is not `cli_` followed by 16 hex characters */
  constructor(opts: FeishuLarkAdapterOptions) {
    super();
    // The SDK's long connection logs and returns, with no callback, for such an id, which would
    // leave connect() waiting for an answer that never comes.
    if (!APP_ID.test(opts.appId)) {
      throw new Error(`${LABEL}: appId must be cli_ followed by 16 hex characters`);
    }
    this.transport =
      opts.transport ??
      createLarkTransport({
        appId: opts.appId,
        appSecret: opts.appSecret,
        ...(opts.domain === undefined ? {} : { domain: opts.domain }),
      });
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    if (this.connecting !== undefined) return this.connecting;
    const attempt = withDeadline(this.openSession(), CONNECT_TIMEOUT_MS, false).finally(() => {
      if (this.connecting === attempt) this.connecting = undefined;
    });
    this.connecting = attempt;
    const ok = await attempt;
    if (!ok) {
      this.generation += 1;
      this.transport.close();
    }
    return ok;
  }

  async disconnect(): Promise<void> {
    this.generation += 1;
    this.connected = false;
    this.connecting = undefined;
    this.transport.close();
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "outbound text is empty" } };
    }
    if (!this.connected) {
      return {
        ok: false,
        error: { code: "not_connected", message: "FeishuLarkAdapter.connect() has not succeeded" },
      };
    }
    const text = this.textFor(out);
    const call =
      out.replyTo === undefined
        ? this.transport.createMessage(out.channel.id, text)
        : this.transport.replyMessage(out.replyTo, text);
    return withDeadline(call.then(toSendResult, toThrownResult), SEND_TIMEOUT_MS, {
      ok: false,
      error: { code: "timeout", message: `Lark did not answer within ${SEND_TIMEOUT_MS} ms` },
    });
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

  /** The text to send: markdown loses its markers, html goes as is with one warning. */
  private textFor(out: OutboundMessage): string {
    if (out.format === "markdown") return channelRendering(this.platform).translate(out.text);
    if (out.format === "html" && !this.warnedAboutHtml) {
      this.warnedAboutHtml = true;
      process.stderr.write(
        `[${LABEL}] format="html" was declared and a Lark text message has no html mode; sending the text unchanged. Logged once.\n`,
      );
    }
    return out.text;
  }

  /**
   * Prove the credentials, then open the long connection. An attempt overtaken by `disconnect()`,
   * or by its own deadline, stops at the next step and leaves nothing open.
   */
  private async openSession(): Promise<boolean> {
    const generation = this.generation;
    let token: LarkApiResult;
    try {
      token = await this.transport.tenantToken();
    } catch (err) {
      process.stderr.write(`[${LABEL}] tenant token request failed: ${messageOf(err)}\n`);
      return false;
    }
    if (generation !== this.generation) return false;
    if (token.code !== 0) {
      process.stderr.write(
        `[${LABEL}] tenant token refused: ${token.code}: ${token.msg ?? "no message"}\n`,
      );
      return false;
    }
    try {
      await this.transport.start({
        onMessage: (data) => this.onMessage(data),
        onError: (err) => this.onConnectionLost(err),
      });
    } catch (err) {
      process.stderr.write(`[${LABEL}] long connection failed: ${messageOf(err)}\n`);
      return false;
    }
    if (generation !== this.generation) {
      this.transport.close();
      return false;
    }
    this.connected = true;
    return true;
  }

  private onConnectionLost(err: Error): void {
    this.connected = false;
    this.transport.close();
    process.stderr.write(`[${LABEL}] long connection gave up: ${err.message}\n`);
  }

  /** Runs inside the SDK's dispatcher: it must return at once and never throw. */
  private onMessage(data: unknown): void {
    const result = normalizeLarkMessage(data, Date.now());
    if (result.kind === "skip") return;
    if (result.kind === "invalid") {
      process.stderr.write(`[${LABEL}] skipped an event: ${result.reason}\n`);
      return;
    }
    if (!this.seen.add(result.event.feishu_lark.eventId)) return;
    queueMicrotask(() => {
      if (!this.connected) return;
      void this.runHandler(this.handler, result.event).catch((err: unknown) => {
        process.stderr.write(`[${LABEL}] handler threw: ${messageOf(err)}\n`);
      });
    });
  }
}

function toSendResult(answer: LarkApiResult): SendResult {
  if (answer.code === 0) {
    return { ok: true, ...(answer.messageId === undefined ? {} : { messageId: answer.messageId }) };
  }
  return {
    ok: false,
    error: { code: "lark_api_error", message: `${answer.code}: ${answer.msg ?? "no message"}` },
  };
}

/** A thrown SDK error, as the open platform's own answer when the response carried one. */
function toThrownResult(err: unknown): SendResult {
  const body = (err as { response?: { data?: { code?: unknown; msg?: unknown } } }).response?.data;
  const message =
    typeof body?.code === "number" ? `${body.code}: ${String(body.msg ?? "")}` : messageOf(err);
  return { ok: false, error: { code: "lark_api_error", message } };
}

/** `work`'s answer, or `fallback` once `ms` passes first. */
async function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
