/**
 * `QQAdapter` — `BasePlatformAdapter` over a QQ Bot: the WebSocket gateway in, the OpenAPI v2
 * message endpoints out.
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
import { splitForQQ } from "./split.js";
import type { QQAdapterOptions, QQSocket } from "./types.js";

const LABEL = "gateway-qq";
const DEFAULT_API = "https://api.sgroup.qq.com";
const DEFAULT_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const CONNECT_TIMEOUT_MS = 30_000;
const SEND_TIMEOUT_MS = 30_000;
const DEFAULT_RECONNECT_MS = 2000;
/** GROUP_AND_C2C_EVENT (1 << 25): direct and group-@ messages. */
const INTENTS = 1 << 25;

const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RECONNECT = 7;
const OP_INVALID_SESSION = 9;
const OP_HELLO = 10;

type Frame = { op?: number; s?: number; t?: string; d?: unknown };

/**
 * QQ Bot adapter for one bot.
 *
 * `connect()` exchanges AppID and AppSecret for an access token, opens the gateway socket,
 * identifies and answers `true` on `READY`, `false`, never a throw, on a refusal or after
 * 30000 ms. A `C2C_MESSAGE_CREATE` (direct message) or `GROUP_AT_MESSAGE_CREATE` dispatch becomes
 * one `QQMessageEvent`; repeats by message id are dropped. A dropped socket is reopened. A reply
 * goes to `channel.id` (a user or group openid) as a passive reply to `replyTo`, or to the last
 * message received from that channel, and a long reply goes as several messages.
 *
 * @public
 */
export class QQAdapter extends BasePlatformAdapter {
  readonly platform = "qq" as const;
  private readonly opts: QQAdapterOptions;
  private handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private socket: QQSocket | undefined;
  private connected = false;
  private connecting: Promise<boolean> | undefined;
  /** Bumped by `disconnect()`, so a connect or reconnect it overtook stops. */
  private generation = 0;
  private token: { value: string; expiresAt: number } | undefined;
  private seq: number | null = null;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly seen = new Set<string>();
  /** The newest inbound message id per channel, for the passive reply. */
  private readonly lastInbound = new Map<string, string>();
  private readonly sequences = new Map<string, number>();

  /** @throws Error when `appId` or `clientSecret` is missing */
  constructor(opts: QQAdapterOptions) {
    super();
    for (const key of ["appId", "clientSecret"] as const) {
      if (typeof opts?.[key] !== "string" || opts[key] === "") {
        throw new Error(`${LABEL}: opts.${key} is required`);
      }
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
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.closeSocket();
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
        error: { code: "not_connected", message: "QQAdapter.connect() has not succeeded" },
      };
    }
    if (out.channel.id === "") {
      return {
        ok: false,
        error: { code: "invalid_channel", message: "channel.id must be a user or group openid" },
      };
    }
    const text =
      out.format === "markdown" ? channelRendering(this.platform).translate(out.text) : out.text;
    const replyTo = out.replyTo ?? this.lastInbound.get(out.channel.id);
    try {
      const messageId = await withTimeout(SEND_TIMEOUT_MS, async () => {
        let id = "";
        for (const part of splitForQQ(text)) id = await this.post(out, part, replyTo, id);
        return id;
      });
      if (messageId === "timeout") {
        return {
          ok: false,
          error: { code: "timeout", message: `QQ did not answer within ${SEND_TIMEOUT_MS} ms` },
        };
      }
      return { ok: true, messageId };
    } catch (err) {
      return { ok: false, error: { code: "qq_send_failed", message: messageOf(err) } };
    }
  }

  /** Post one message; answers its id, or `previous` when the reply names none. Throws on a refusal. */
  private async post(
    out: OutboundMessage,
    content: string,
    replyTo: string | undefined,
    previous: string,
  ): Promise<string> {
    const base = (this.opts.apiBase ?? DEFAULT_API).replace(/\/+$/, "");
    const kind = out.channel.type === "dm" ? "users" : "groups";
    const body: Record<string, unknown> = { content, msg_type: 0 };
    if (replyTo !== undefined) {
      body.msg_id = replyTo;
      body.msg_seq = this.nextSequence(replyTo);
    }
    const json = await this.api(
      `${base}/v2/${kind}/${encodeURIComponent(out.channel.id)}/messages`,
      body,
    );
    const id = (json as { id?: unknown } | undefined)?.id;
    return typeof id === "string" && id !== "" ? id : previous;
  }

  /** The next `msg_seq` for a passive reply to `replyTo`; QQ refuses a repeated one. */
  private nextSequence(replyTo: string): number {
    const next = (this.sequences.get(replyTo) ?? 0) + 1;
    this.sequences.set(replyTo, next);
    forget(this.sequences);
    return next;
  }

  private async api(url: string, body: unknown): Promise<unknown> {
    const response = await (this.opts.fetch ?? fetch)(url, {
      method: "POST",
      headers: {
        authorization: `QQBot ${await this.accessToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = (await response.text().catch(() => "")).slice(0, 200);
      throw new Error(`QQ answered ${response.status} ${text}`.trim());
    }
    return response.json().catch(() => undefined);
  }

  /** The access token, fetched again a minute before it expires. */
  private async accessToken(): Promise<string> {
    if (this.token !== undefined && Date.now() < this.token.expiresAt) return this.token.value;
    const response = await (this.opts.fetch ?? fetch)(this.opts.tokenUrl ?? DEFAULT_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appId: this.opts.appId, clientSecret: this.opts.clientSecret }),
    });
    if (!response.ok) throw new Error(`QQ token endpoint answered ${response.status}`);
    const json = (await response.json().catch(() => undefined)) as
      | { access_token?: unknown; expires_in?: unknown }
      | undefined;
    if (typeof json?.access_token !== "string" || json.access_token === "") {
      throw new Error("QQ token endpoint answered without an access_token");
    }
    const seconds = Number(json.expires_in);
    const ttl = (Number.isFinite(seconds) && seconds > 0 ? seconds : 7200) * 1000;
    this.token = { value: json.access_token, expiresAt: Date.now() + Math.max(ttl - 60_000, 0) };
    return json.access_token;
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

  /** Open the socket and settle `true` on `READY`, `false` when it closes or errors first. */
  private async openSocket(generation: number): Promise<boolean> {
    const token = await this.accessToken();
    const gateway = await this.gatewayUrl(token);
    return new Promise<boolean>((resolve) => {
      const socket = (this.opts.socket ?? defaultSocket)(gateway);
      this.socket = socket;
      socket.addEventListener("message", (event) => this.onFrame(event.data, socket, resolve));
      socket.addEventListener("error", (err) => {
        process.stderr.write(`[${LABEL}] socket error: ${messageOf(err)}\n`);
        resolve(false);
      });
      socket.addEventListener("close", (event) => {
        resolve(false);
        if (socket !== this.socket || generation !== this.generation) return;
        this.connected = false;
        this.socket = undefined;
        clearInterval(this.heartbeat);
        process.stderr.write(
          `[${LABEL}] socket closed: ${event.code ?? ""} ${event.reason ?? ""}\n`,
        );
        this.scheduleReconnect(generation);
      });
    });
  }

  private async gatewayUrl(token: string): Promise<string> {
    const base = (this.opts.apiBase ?? DEFAULT_API).replace(/\/+$/, "");
    const response = await (this.opts.fetch ?? fetch)(`${base}/gateway`, {
      headers: { authorization: `QQBot ${token}` },
    });
    if (!response.ok) throw new Error(`QQ gateway lookup answered ${response.status}`);
    const json = (await response.json().catch(() => undefined)) as { url?: unknown } | undefined;
    if (typeof json?.url !== "string" || json.url === "") {
      throw new Error("QQ gateway lookup answered without a url");
    }
    return json.url;
  }

  private scheduleReconnect(generation: number): void {
    const delay = this.opts.reconnectDelayMs ?? DEFAULT_RECONNECT_MS;
    if (delay <= 0) return;
    // One pending retry at most: a failed reconnect reaches here from both its close event and its result.
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.reconnect(generation).catch(() => this.scheduleReconnect(generation));
    }, delay);
  }

  private async reconnect(generation: number): Promise<void> {
    const ok = await this.openSocket(generation);
    if (generation !== this.generation) return;
    if (ok) this.connected = true;
    else this.scheduleReconnect(generation);
  }

  private closeSocket(): void {
    clearInterval(this.heartbeat);
    const socket = this.socket;
    this.socket = undefined;
    try {
      socket?.close();
    } catch (err) {
      process.stderr.write(`[${LABEL}] socket close failed: ${messageOf(err)}\n`);
    }
  }

  private onFrame(data: unknown, socket: QQSocket, ready: (ok: boolean) => void): void {
    const frame = parseFrame(data);
    if (frame === undefined) return;
    if (typeof frame.s === "number") this.seq = frame.s;
    switch (frame.op) {
      case OP_HELLO:
        this.identify(socket, frame.d);
        return;
      case OP_RECONNECT:
      case OP_INVALID_SESSION:
        // Close; the close handler reopens with a fresh identify.
        if (frame.op === OP_INVALID_SESSION) ready(false);
        socket.close();
        return;
      case OP_DISPATCH:
        if (frame.t === "READY") ready(true);
        else this.onDispatch(frame);
        return;
      default:
    }
  }

  private identify(socket: QQSocket, hello: unknown): void {
    this.sendFrame(socket, {
      op: OP_IDENTIFY,
      d: {
        token: `QQBot ${this.token?.value ?? ""}`,
        intents: INTENTS,
        shard: [0, 1],
        properties: {},
      },
    });
    const interval = (hello as { heartbeat_interval?: unknown } | undefined)?.heartbeat_interval;
    clearInterval(this.heartbeat);
    if (typeof interval === "number" && interval > 0) {
      this.heartbeat = setInterval(
        () => this.sendFrame(socket, { op: OP_HEARTBEAT, d: this.seq }),
        interval,
      );
    }
  }

  private sendFrame(socket: QQSocket, frame: unknown): void {
    try {
      socket.send(JSON.stringify(frame));
    } catch (err) {
      process.stderr.write(`[${LABEL}] socket send failed: ${messageOf(err)}\n`);
    }
  }

  private onDispatch(frame: Frame): void {
    const event = toMessageEvent(frame);
    if (event === undefined || this.seen.has(event.id)) return;
    this.seen.add(event.id);
    forget(this.seen);
    this.lastInbound.set(event.channel.id, event.id);
    forget(this.lastInbound);
    void this.runHandler(this.handler, event).catch((err: unknown) => {
      process.stderr.write(`[${LABEL}] handler threw: ${messageOf(err)}\n`);
    });
  }
}

/** Who wrote and where, from the dispatch type; `undefined` for a dispatch that is no message. */
function routeOf(
  type: string | undefined,
  d: Record<string, unknown>,
  author: Record<string, unknown>,
): { senderId: string; channelId: string; type: "dm" | "group"; groupOpenId: string } | undefined {
  if (type === "C2C_MESSAGE_CREATE") {
    const senderId = str(author.user_openid) ?? str(author.id);
    return senderId === undefined
      ? undefined
      : { senderId, channelId: senderId, type: "dm", groupOpenId: "" };
  }
  if (type !== "GROUP_AT_MESSAGE_CREATE") return undefined;
  const senderId = str(author.member_openid) ?? str(author.id);
  const channelId = str(d.group_openid);
  return senderId === undefined || channelId === undefined
    ? undefined
    : { senderId, channelId, type: "group", groupOpenId: channelId };
}

function toMessageEvent(frame: Frame): GatewayMessageEvent | undefined {
  const d = asRecord(frame.d);
  const author = asRecord(d?.author);
  const id = str(d?.id);
  if (d === undefined || author === undefined || id === undefined) return undefined;
  if (typeof d.content !== "string") return undefined;
  const route = routeOf(frame.t, d, author);
  if (route === undefined) return undefined;
  const ts = Date.parse(str(d.timestamp) ?? "");
  return {
    id,
    platform: "qq",
    sender: { id: route.senderId },
    channel: { id: route.channelId, type: route.type },
    text: d.content.trim(),
    receivedAt: Number.isFinite(ts) ? ts : Date.now(),
    qq: { messageId: id, openId: route.senderId, groupOpenId: route.groupOpenId, raw: d },
  } as unknown as GatewayMessageEvent;
}

/** Drop the oldest entry once a bounded cache holds more than 1000. */
function forget(cache: Set<string> | Map<string, unknown>): void {
  if (cache.size <= 1000) return;
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
}

/** The default socket: Node's global `WebSocket`. */
function defaultSocket(url: string): QQSocket {
  const Ctor = (globalThis as { WebSocket?: new (u: string) => QQSocket }).WebSocket;
  if (Ctor === undefined) throw new Error("this runtime has no global WebSocket");
  return new Ctor(url);
}

function parseFrame(data: unknown): Frame | undefined {
  try {
    return asRecord(JSON.parse(typeof data === "string" ? data : String(data))) as Frame;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
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
