/**
 * `BuzzAdapter` — `BasePlatformAdapter` over a Buzz server: messages are posted with
 * `POST /api/channels/{id}/messages` and read from the realtime WebSocket, both with a bot token.
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
import { splitForBuzz } from "./split.js";
import type { BuzzAdapterOptions, BuzzSocket } from "./types.js";

const LABEL = "gateway-buzz";
const CONNECT_TIMEOUT_MS = 30_000;
const SEND_TIMEOUT_MS = 30_000;
const DEFAULT_RECONNECT_MS = 2000;

/**
 * Buzz adapter for one bot.
 *
 * `connect()` opens the realtime socket and answers `true` once it is open, `false`, never a
 * throw, on a refused socket or after 30000 ms. A `message.created` event from someone other than
 * the bot becomes one `BuzzMessageEvent` (repeats by message id are dropped). A dropped
 * socket is reopened from the last cursor seen. A reply longer than 4000 characters goes as
 * several messages, in order.
 *
 * @public
 */
export class BuzzAdapter extends BasePlatformAdapter {
  readonly platform = "buzz" as const;
  private readonly opts: BuzzAdapterOptions;
  private readonly base: string;
  private handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private socket: BuzzSocket | undefined;
  private connected = false;
  private connecting: Promise<boolean> | undefined;
  /** Bumped by `disconnect()`, so a connect or reconnect it overtook stops. */
  private generation = 0;
  private cursor = "";
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly seen = new Set<string>();
  private warnedAboutHtml = false;

  /** @throws Error when `baseUrl`, `token`, `workspaceId` or `botUserId` is missing */
  constructor(opts: BuzzAdapterOptions) {
    super();
    for (const key of ["baseUrl", "token", "workspaceId", "botUserId"] as const) {
      if (typeof opts?.[key] !== "string" || opts[key] === "") {
        throw new Error(`${LABEL}: ${key} is required`);
      }
    }
    this.opts = opts;
    this.base = opts.baseUrl.replace(/\/+$/, "");
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
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.closeSocket();
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
    if (!this.connected) {
      return {
        ok: false,
        error: { code: "not_connected", message: "BuzzAdapter.connect() has not succeeded" },
      };
    }
    if (out.channel.id === "") {
      return {
        ok: false,
        error: { code: "invalid_channel", message: "channel.id must be a channel id" },
      };
    }
    const parts = splitForBuzz(this.textFor(out));
    const answer = await withTimeout(SEND_TIMEOUT_MS, async () => {
      let messageId = "";
      for (const body of parts) messageId = await this.post(out.channel.id, body, messageId);
      return messageId;
    }).catch((err: unknown) => ({ failure: messageOf(err) }));
    if (answer === "timeout") {
      return {
        ok: false,
        error: {
          code: "timeout",
          message: `Buzz did not answer within ${SEND_TIMEOUT_MS} ms`,
        },
      };
    }
    if (typeof answer === "object") {
      return { ok: false, error: { code: "buzz_send_failed", message: answer.failure } };
    }
    return { ok: true, messageId: answer };
  }

  /** Post one message; answers its id, or `previous` when the reply names none. Throws on a refusal. */
  private async post(channelId: string, body: string, previous: string): Promise<string> {
    const doFetch = this.opts.fetch ?? fetch;
    const response = await doFetch(
      `${this.base}/api/channels/${encodeURIComponent(channelId)}/messages`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${this.opts.token}`, "content-type": "application/json" },
        body: JSON.stringify({ body, nonce: crypto.randomUUID() }),
      },
    );
    if (!response.ok) {
      throw new Error(`Buzz answered ${response.status} ${await safeText(response)}`.trim());
    }
    const json = (await response.json().catch(() => undefined)) as unknown;
    return pickId(json) ?? previous;
  }

  /** The text to send: markdown loses its markers, html goes as is with one warning. */
  private textFor(out: OutboundMessage): string {
    if (out.format === "markdown") return channelRendering(this.platform).translate(out.text);
    if (out.format === "html" && !this.warnedAboutHtml) {
      this.warnedAboutHtml = true;
      process.stderr.write(
        `[${LABEL}] format="html" was declared and Buzz is plain text here; sending the text unchanged. Logged once.\n`,
      );
    }
    return out.text;
  }

  private async open(): Promise<boolean> {
    const generation = this.generation;
    const result = await withTimeout(CONNECT_TIMEOUT_MS, () => this.openSocket(generation)).catch(
      (err: unknown) => {
        process.stderr.write(`[${LABEL}] connect failed: ${messageOf(err)}\n`);
        return false as const;
      },
    );
    if (result === true && generation === this.generation) {
      this.connected = true;
      return true;
    }
    if (result === "timeout") {
      process.stderr.write(
        `[${LABEL}] connect failed: no answer within ${CONNECT_TIMEOUT_MS} ms\n`,
      );
    }
    if (generation === this.generation) this.closeSocket();
    return false;
  }

  /** Open the socket and settle `true` when it opens, `false` when it closes or errors first. */
  private openSocket(generation: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const query = new URLSearchParams({ workspace_id: this.opts.workspaceId });
      if (this.cursor !== "") query.set("after_cursor", this.cursor);
      const url = `${this.base.replace(/^http/, "ws")}/api/realtime/ws?${query.toString()}`;
      const headers = { authorization: `Bearer ${this.opts.token}` };
      const factory = this.opts.socket ?? defaultSocket;
      const socket = factory(url, headers);
      this.socket = socket;
      socket.addEventListener("open", () => resolve(true));
      socket.addEventListener("message", (event) => this.onFrame(event.data));
      socket.addEventListener("error", (err) => {
        process.stderr.write(`[${LABEL}] socket error: ${messageOf(err)}\n`);
        resolve(false);
      });
      socket.addEventListener("close", (event) => {
        resolve(false);
        if (socket !== this.socket || generation !== this.generation) return;
        this.connected = false;
        this.socket = undefined;
        process.stderr.write(
          `[${LABEL}] socket closed: ${event.code ?? ""} ${event.reason ?? ""}\n`,
        );
        this.scheduleReconnect(generation);
      });
    });
  }

  private scheduleReconnect(generation: number): void {
    const delay = this.opts.reconnectDelayMs ?? DEFAULT_RECONNECT_MS;
    if (delay <= 0) return;
    // One pending retry at most: a failed reconnect reaches here from both its close event and its result.
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.reconnect(generation).catch(() => undefined);
    }, delay);
  }

  private async reconnect(generation: number): Promise<void> {
    const ok = await this.openSocket(generation);
    if (generation !== this.generation) return;
    if (ok) this.connected = true;
    else this.scheduleReconnect(generation);
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = undefined;
    try {
      socket?.close();
    } catch (err) {
      process.stderr.write(`[${LABEL}] socket close failed: ${messageOf(err)}\n`);
    }
  }

  private onFrame(data: unknown): void {
    const f = parseFrame(data);
    if (f === undefined) return;
    if (f.type === "resync_required") {
      // The cursor is too old: drop it and reopen from now.
      this.cursor = "";
      this.closeSocket();
      this.scheduleReconnect(this.generation);
      return;
    }
    if (f.cursor !== undefined && f.cursor !== null) this.cursor = String(f.cursor);
    if (f.type !== "message.created") return;
    const event = this.toMessageEvent(f);
    if (event === undefined || this.seen.has(event.id)) return;
    this.remember(event.id);
    void this.runHandler(this.handler, event).catch((err: unknown) => {
      process.stderr.write(`[${LABEL}] handler threw: ${messageOf(err)}\n`);
    });
  }

  private remember(id: string): void {
    this.seen.add(id);
    if (this.seen.size <= 1000) return;
    const oldest = this.seen.values().next().value;
    if (oldest !== undefined) this.seen.delete(oldest);
  }

  private toMessageEvent(frame: Record<string, unknown>): GatewayMessageEvent | undefined {
    const payload = asRecord(frame.payload) ?? asRecord(frame.data) ?? frame;
    const message = asRecord(payload.message) ?? payload;
    const id = str(message.id);
    const channelId = str(message.channel_id);
    const author = authorOf(message);
    // Text only: a message with no string body (an upload, a card) is not an event.
    if (id === undefined || channelId === undefined || typeof message.body !== "string") {
      return undefined;
    }
    if (author === this.opts.botUserId) return undefined;
    const threadId = threadOf(message);
    const direct = message.is_dm === true || message.channel_type === "dm";
    return {
      id,
      platform: "buzz",
      sender: { id: author ?? "", username: str(message.author_name) ?? "" },
      channel: { id: channelId, type: direct ? "dm" : "group" },
      text: message.body,
      receivedAt: Date.now(),
      buzz: {
        messageId: id,
        channelId,
        workspaceId:
          str(message.workspace_id) ?? str(payload.workspace_id) ?? this.opts.workspaceId,
        threadId,
        cursor: this.cursor,
        raw: frame,
      },
    };
  }
}

/** The default socket: Node's global `WebSocket`, which takes request headers as an option. */
function defaultSocket(url: string, headers: Readonly<Record<string, string>>): BuzzSocket {
  const Ctor = (globalThis as { WebSocket?: new (u: string, o: unknown) => BuzzSocket })
    .WebSocket;
  if (Ctor === undefined) throw new Error("this runtime has no global WebSocket");
  return new Ctor(url, { headers });
}

function parseFrame(data: unknown): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(typeof data === "string" ? data : String(data)));
  } catch {
    return undefined;
  }
}

function threadOf(message: Record<string, unknown>): string {
  return str(message.thread_id) ?? str(message.parent_id) ?? "";
}

function authorOf(message: Record<string, unknown>): string | undefined {
  return str(message.author_user_id) ?? str(message.user_id) ?? str(message.author_id);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== ""
    ? value
    : typeof value === "number"
      ? String(value)
      : undefined;
}

function pickId(json: unknown): string | undefined {
  const root = asRecord(json);
  return str(root?.id) ?? str(asRecord(root?.message)?.id);
}

async function safeText(response: Response): Promise<string> {
  return (await response.text().catch(() => "")).slice(0, 200);
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
