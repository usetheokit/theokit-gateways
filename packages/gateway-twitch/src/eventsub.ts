/**
 * `EventSubSession` — the EventSub WebSocket: the welcome, the keepalive watchdog, the
 * `session_reconnect` handover, and reconnection after a drop.
 *
 * Frame shapes are Twitch's (https://dev.twitch.tv/docs/eventsub/handling-websocket-events/):
 * `{ metadata: { message_id, message_type, subscription_type? }, payload }`.
 */

import type { TwitchSocket } from "./types.js";

const FIRST_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const STABLE_SESSION_MS = 60_000;
/** Twitch's own window plus a margin, so a keepalive arriving on time never trips the watchdog. */
const KEEPALIVE_MARGIN_MS = 5_000;
/** How long a new socket may take to send its welcome before it counts as dropped. */
const WELCOME_TIMEOUT_MS = 10_000;

/** A notification's `metadata`. */
export interface EventSubMetadata {
  readonly message_id?: string;
  readonly message_type?: string;
  readonly subscription_type?: string;
}

/** What the session needs. */
export interface EventSubOptions {
  readonly url: string;
  readonly socketFactory: (url: string) => TwitchSocket;
  /** A welcome: `"new"` needs subscriptions, `"handover"` (after `session_reconnect`) keeps them. */
  readonly onWelcome: (sessionId: string, kind: "new" | "handover") => void;
  readonly onNotification: (metadata: EventSubMetadata, payload: unknown) => void;
  readonly onRevocation: (subscription: unknown) => void;
}

interface Connection {
  readonly socket: TwitchSocket;
  watchdog: ReturnType<typeof setTimeout> | undefined;
  welcomeTimer: ReturnType<typeof setTimeout> | undefined;
  keepaliveMs: number | undefined;
  /** Closed on purpose: its close is not a drop. */
  retired: boolean;
}

interface Envelope {
  readonly metadata?: EventSubMetadata;
  readonly payload?: {
    readonly session?: {
      readonly id?: unknown;
      readonly keepalive_timeout_seconds?: unknown;
      readonly reconnect_url?: unknown;
    };
    readonly subscription?: unknown;
  };
}

/** One EventSub session, kept alive across drops and handovers. */
export class EventSubSession {
  private current: Connection | undefined;
  private pending: Connection | undefined;
  private openedAt: number | undefined;
  private nextDelayMs = FIRST_RECONNECT_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(private readonly opts: EventSubOptions) {}

  /** Open the socket; the welcome arrives through `onWelcome`. */
  open(): void {
    this.closed = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    for (const connection of [this.current, this.pending]) {
      if (connection !== undefined) this.retire(connection);
    }
    this.pending = undefined;
    this.current = this.dial(this.opts.url);
  }

  /** Treat the current socket as dropped: it closes, and a new session is dialled with backoff. */
  restart(): void {
    this.current?.socket.close();
  }

  /** Close every socket and clear every timer. Idempotent. */
  close(): void {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    for (const connection of [this.current, this.pending]) {
      if (connection !== undefined) this.retire(connection);
    }
    this.current = undefined;
    this.pending = undefined;
  }

  private dial(url: string): Connection {
    const socket = this.opts.socketFactory(url);
    const connection: Connection = {
      socket,
      watchdog: undefined,
      welcomeTimer: undefined,
      keepaliveMs: undefined,
      retired: false,
    };
    // A socket that opens and never welcomes, or never opens at all, would hold the session for ever.
    connection.welcomeTimer = setTimeout(() => socket.close(), WELCOME_TIMEOUT_MS);
    socket.onmessage = (message) => this.onFrame(connection, message.data);
    socket.onclose = () => this.onClose(connection);
    socket.onerror = () => undefined;
    return connection;
  }

  private onFrame(connection: Connection, data: unknown): void {
    if (connection.retired || typeof data !== "string") return;
    let envelope: Envelope;
    try {
      envelope = JSON.parse(data) as Envelope;
    } catch {
      // Not JSON: no message type to act on; the watchdog still counts it as a sign of life.
      envelope = {};
    }
    this.arm(connection);
    const type = envelope.metadata?.message_type;
    if (type === "session_welcome") this.onWelcomeFrame(connection, envelope);
    else if (type === "notification")
      this.opts.onNotification(envelope.metadata ?? {}, envelope.payload);
    else if (type === "session_reconnect") this.onReconnectFrame(envelope);
    else if (type === "revocation") this.opts.onRevocation(envelope.payload?.subscription);
  }

  private onWelcomeFrame(connection: Connection, envelope: Envelope): void {
    const session = envelope.payload?.session;
    const seconds = Number(session?.keepalive_timeout_seconds);
    clearTimeout(connection.welcomeTimer);
    connection.welcomeTimer = undefined;
    connection.keepaliveMs = Number.isFinite(seconds)
      ? seconds * 1_000 + KEEPALIVE_MARGIN_MS
      : undefined;
    this.arm(connection);
    const sessionId = typeof session?.id === "string" ? session.id : "";
    if (connection === this.pending) {
      // The new socket is up: the old one goes now, and its subscriptions carry over.
      const old = this.current;
      this.current = connection;
      this.pending = undefined;
      if (old !== undefined) this.retire(old);
      this.opts.onWelcome(sessionId, "handover");
      return;
    }
    this.openedAt = Date.now();
    this.opts.onWelcome(sessionId, "new");
  }

  private onReconnectFrame(envelope: Envelope): void {
    const url = envelope.payload?.session?.reconnect_url;
    if (typeof url !== "string" || this.pending !== undefined) return;
    this.pending = this.dial(url);
  }

  /** (Re)start the watchdog: no frame within the keepalive window counts as a drop. */
  private arm(connection: Connection): void {
    clearTimeout(connection.watchdog);
    if (connection.keepaliveMs === undefined) return;
    connection.watchdog = setTimeout(() => connection.socket.close(), connection.keepaliveMs);
  }

  private retire(connection: Connection): void {
    connection.retired = true;
    clearTimeout(connection.welcomeTimer);
    clearTimeout(connection.watchdog);
    connection.watchdog = undefined;
    connection.socket.close();
  }

  private onClose(connection: Connection): void {
    clearTimeout(connection.welcomeTimer);
    clearTimeout(connection.watchdog);
    connection.watchdog = undefined;
    if (connection.retired || this.closed) return;
    connection.retired = true;
    if (connection === this.pending) {
      // The handover socket failed before its welcome; the old one is still serving.
      this.pending = undefined;
      return;
    }
    if (connection !== this.current) return;
    this.current = undefined;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.openedAt !== undefined && Date.now() - this.openedAt >= STABLE_SESSION_MS) {
      this.nextDelayMs = FIRST_RECONNECT_DELAY_MS;
    }
    this.openedAt = undefined;
    const delay = this.nextDelayMs;
    this.nextDelayMs = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.closed) this.current = this.dial(this.opts.url);
    }, delay);
  }
}
