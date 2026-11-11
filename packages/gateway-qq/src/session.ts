/**
 * The QQ Bot gateway session: hello, identify or resume, heartbeat, reconnect.
 *
 * @public
 */

import type { QQApi } from "./api.js";
import type { QQAdapterOptions, QQSocket } from "./types.js";

const DEFAULT_INTENTS = 1 << 25;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;

const defaultSocketFactory = (url: string): QQSocket => new WebSocket(url) as unknown as QQSocket;

interface Frame {
  op?: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

/** Keeps one gateway socket open and hands every dispatch to `onDispatch`. */
export class QQSession {
  private socket: QQSocket | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private seq: number | null = null;
  private sessionId: string | undefined;
  private stopped = true;
  private attempts = 0;
  private ready: ((ok: boolean) => void) | undefined;

  constructor(
    private readonly api: QQApi,
    private readonly opts: QQAdapterOptions,
    private readonly onDispatch: (type: string, data: unknown) => void,
  ) {}

  /** Open the socket; `true` once the gateway answers READY (or RESUMED), `false` otherwise. */
  async start(): Promise<boolean> {
    this.stopped = false;
    const timeoutMs = this.opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      this.ready = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      this.open().catch((err: unknown) => {
        process.stderr.write(`[gateway-qq] connect failed: ${errMessage(err)}\n`);
        resolve(false);
      });
    });
    this.ready = undefined;
    if (!ok) this.stop();
    return ok;
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
  }

  private async open(): Promise<void> {
    const url = await this.api.gatewayUrl();
    const socket = (this.opts.socketFactory ?? defaultSocketFactory)(url);
    this.socket = socket;
    socket.onmessage = (m) => this.onFrame(socket, m.data);
    socket.onerror = () => undefined;
    socket.onclose = () => this.onClose(socket);
  }

  private onClose(socket: QQSocket): void {
    if (this.socket !== socket) return;
    this.socket = undefined;
    this.clearTimers();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = Math.min(1000 * 2 ** this.attempts, MAX_BACKOFF_MS);
    this.attempts += 1;
    this.retry = setTimeout(() => {
      this.open().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private clearTimers(): void {
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
    if (this.retry !== undefined) clearTimeout(this.retry);
    this.heartbeat = undefined;
    this.retry = undefined;
  }

  private onFrame(socket: QQSocket, data: unknown): void {
    let frame: Frame;
    try {
      frame = JSON.parse(typeof data === "string" ? data : String(data)) as Frame;
    } catch {
      return;
    }
    if (typeof frame.s === "number") this.seq = frame.s;
    switch (frame.op) {
      case 10:
        this.onHello(socket, frame.d);
        break;
      case 0:
        this.onDispatchFrame(frame);
        break;
      case 7:
        socket.close();
        break;
      case 9:
        this.sessionId = undefined;
        this.seq = null;
        socket.close();
        break;
      default:
    }
  }

  private onHello(socket: QQSocket, d: unknown): void {
    const interval =
      (d as { heartbeat_interval?: number } | undefined)?.heartbeat_interval ?? 40_000;
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(
      () => socket.send(JSON.stringify({ op: 1, d: this.seq })),
      interval,
    );
    this.authenticate(socket).catch((err: unknown) => {
      process.stderr.write(`[gateway-qq] identify failed: ${errMessage(err)}\n`);
      socket.close();
    });
  }

  private async authenticate(socket: QQSocket): Promise<void> {
    const token = `QQBot ${await this.api.token()}`;
    const frame =
      this.sessionId !== undefined
        ? { op: 6, d: { token, session_id: this.sessionId, seq: this.seq } }
        : {
            op: 2,
            d: { token, intents: this.opts.intents ?? DEFAULT_INTENTS, shard: [0, 1] },
          };
    socket.send(JSON.stringify(frame));
  }

  private onDispatchFrame(frame: Frame): void {
    if (frame.t === "READY") {
      this.sessionId = (frame.d as { session_id?: string } | undefined)?.session_id;
      this.attempts = 0;
      this.ready?.(true);
    } else if (frame.t === "RESUMED") {
      this.attempts = 0;
      this.ready?.(true);
    } else if (typeof frame.t === "string") {
      this.onDispatch(frame.t, frame.d);
    }
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
