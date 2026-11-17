/**
 * `ZaloPersonalAdapter` — `BasePlatformAdapter` over a personal Zalo account, through the
 * unofficial `zca-js` web session.
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

import { refuseAttachments } from "./refuse-attachments.js";
import { splitForZaloPersonal } from "./split.js";
import type {
  ZaloApi,
  ZaloListenerMessage,
  ZaloLogin,
  ZaloPersonalAdapterOptions,
} from "./types.js";

const LABEL = "gateway-zalo-personal";
const CONNECT_TIMEOUT_MS = 30_000;
const SEND_TIMEOUT_MS = 30_000;
const THREAD_USER = 0;
const THREAD_GROUP = 1;

/** The default login: `zca-js`, imported when first needed so it stays the consumer's install. */
const defaultLogin: ZaloLogin = async (credentials) => {
  const specifier = "zca-js";
  let mod: { Zalo?: new () => { login(c: unknown): Promise<ZaloApi> } };
  try {
    mod = (await import(specifier)) as typeof mod;
  } catch {
    throw new Error("the `zca-js` package is not installed; add it to use this adapter");
  }
  if (mod.Zalo === undefined) throw new Error("`zca-js` does not export `Zalo`");
  return new mod.Zalo().login(credentials);
};

/**
 * Zalo Personal adapter for one personal account.
 *
 * `connect()` logs in and starts the listener; it answers `true` once the listener is started and
 * `false`, never a throw, on a refused login, a missing `zca-js` or after 30000 ms. A direct or
 * group message from someone else becomes one `ZaloPersonalMessageEvent` (repeats by message id
 * are dropped). A reply longer than 2000 characters goes as several messages, in order.
 *
 * This is an unofficial client of a personal account: Zalo may restrict an account that automates.
 *
 * @public
 */
export class ZaloPersonalAdapter extends BasePlatformAdapter {
  readonly platform = "zalo_personal" as const;
  private readonly opts: ZaloPersonalAdapterOptions;
  private handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private api: ZaloApi | undefined;
  private connected = false;
  private connecting: Promise<boolean> | undefined;
  /** Bumped by `disconnect()`, so a connect it overtook does not report connected. */
  private generation = 0;
  private readonly seen = new Set<string>();
  private warnedAboutHtml = false;

  /** @throws Error when `credentials` lacks an imei or a user agent */
  constructor(opts: ZaloPersonalAdapterOptions) {
    super();
    const c = opts.credentials;
    if (!c || typeof c.imei !== "string" || c.imei === "" || typeof c.userAgent !== "string") {
      throw new Error(`${LABEL}: credentials must hold a cookie, an imei and a userAgent`);
    }
    this.opts = opts;
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    if (this.connecting !== undefined) return this.connecting;
    const attempt = this.open().finally(() => {
      if (this.connecting === attempt) this.connecting = undefined;
    });
    this.connecting = attempt;
    return attempt;
  }

  async disconnect(): Promise<void> {
    this.generation += 1;
    this.connected = false;
    this.connecting = undefined;
    this.stopListener();
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    return refuseAttachments(out) ?? this.sendText(out);
  }

  onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    // Replace, not stack.
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = undefined;
    };
  }

  /** Deliver an event that arrived out of band, through `runHandler`. */
  override async deliver(
    event: GatewayMessageEvent,
  ): Promise<"ok" | "no_handler" | "handler_threw"> {
    return this.runHandler(this.handler, event);
  }

  private async sendText(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "outbound text is empty" } };
    }
    const api = this.api;
    if (!this.connected || api === undefined) {
      return {
        ok: false,
        error: {
          code: "not_connected",
          message: "ZaloPersonalAdapter.connect() has not succeeded",
        },
      };
    }
    if (out.channel.id === "") {
      return {
        ok: false,
        error: { code: "invalid_channel", message: "channel.id must be a thread id" },
      };
    }
    const type = out.channel.type === "group" ? THREAD_GROUP : THREAD_USER;
    const parts = splitForZaloPersonal(this.textFor(out));
    const answer = await withTimeout(SEND_TIMEOUT_MS, async () => {
      let messageId = "";
      for (const text of parts) {
        const sent = await api.sendMessage({ msg: text }, out.channel.id, type);
        const id = sent?.message?.msgId;
        messageId = id === undefined || id === null ? messageId : String(id);
      }
      return messageId;
    }).catch((err: unknown) => ({ failure: messageOf(err) }));
    if (answer === "timeout") {
      return {
        ok: false,
        error: { code: "timeout", message: `Zalo did not answer within ${SEND_TIMEOUT_MS} ms` },
      };
    }
    if (typeof answer === "object") {
      return { ok: false, error: { code: "zalo_send_failed", message: answer.failure } };
    }
    return { ok: true, messageId: answer };
  }

  /** The text to send: markdown loses its markers, html goes as is with one warning. */
  private textFor(out: OutboundMessage): string {
    if (out.format === "markdown") return channelRendering(this.platform).translate(out.text);
    if (out.format === "html" && !this.warnedAboutHtml) {
      this.warnedAboutHtml = true;
      process.stderr.write(
        `[${LABEL}] format="html" was declared and Zalo is plain text; sending the text unchanged. Logged once.\n`,
      );
    }
    return out.text;
  }

  private async open(): Promise<boolean> {
    const generation = this.generation;
    const login = this.opts.login ?? defaultLogin;
    const result = await withTimeout(CONNECT_TIMEOUT_MS, async () => {
      const api = await login(this.opts.credentials);
      if (generation !== this.generation) return false;
      api.listener.on("message", (message) => this.onMessage(message));
      api.listener.on("error", (err) =>
        process.stderr.write(`[${LABEL}] listener error: ${messageOf(err)}\n`),
      );
      api.listener.on("closed", (code, reason) => {
        if (api === this.api) this.connected = false;
        process.stderr.write(`[${LABEL}] listener closed: ${code} ${reason}\n`);
      });
      api.listener.start();
      this.api = api;
      return true;
    }).catch((err: unknown) => {
      process.stderr.write(`[${LABEL}] connect failed: ${messageOf(err)}\n`);
      return false as const;
    });
    if (result === true && generation === this.generation) {
      this.connected = true;
      return true;
    }
    if (result === "timeout") {
      process.stderr.write(
        `[${LABEL}] connect failed: no answer within ${CONNECT_TIMEOUT_MS} ms\n`,
      );
    }
    if (generation === this.generation) this.stopListener();
    return false;
  }

  private stopListener(): void {
    const api = this.api;
    this.api = undefined;
    try {
      api?.listener.stop();
    } catch (err) {
      process.stderr.write(`[${LABEL}] listener stop failed: ${messageOf(err)}\n`);
    }
  }

  private onMessage(message: ZaloListenerMessage): void {
    if (message.isSelf === true) return;
    const event = toMessageEvent(message);
    if (event === undefined) return;
    if (this.seen.has(event.id)) return;
    this.seen.add(event.id);
    if (this.seen.size > 1000) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    void this.runHandler(this.handler, event).catch((err: unknown) => {
      process.stderr.write(`[${LABEL}] handler threw: ${messageOf(err)}\n`);
    });
  }
}

function toMessageEvent(message: ZaloListenerMessage): GatewayMessageEvent | undefined {
  const data = message.data;
  const msgId = data?.msgId;
  const from = data?.uidFrom;
  if (
    (typeof msgId !== "string" && typeof msgId !== "number") ||
    (typeof from !== "string" && typeof from !== "number") ||
    typeof message.threadId !== "string"
  ) {
    return undefined;
  }
  // Only plain text: a sticker, an image or a card has an object for content.
  if (typeof data.content !== "string") return undefined;
  const group = message.type === THREAD_GROUP;
  const name = typeof data.dName === "string" ? data.dName : "";
  return {
    id: String(msgId),
    platform: "zalo_personal",
    sender: { id: String(from), username: name },
    channel: { id: message.threadId, type: group ? "group" : "dm" },
    text: data.content,
    receivedAt: Date.now(),
    zalo_personal: {
      messageId: String(msgId),
      threadId: message.threadId,
      threadType: group ? "group" : "user",
      senderUid: String(from),
      raw: message,
    },
  };
}

/** Run `work`; `"timeout"` once `ms` passes first. */
async function withTimeout<T>(ms: number, work: () => Promise<T>): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    return await Promise.race([work(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
