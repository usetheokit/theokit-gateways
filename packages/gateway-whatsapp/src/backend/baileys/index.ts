/**
 * `WhatsAppBaileysBackend` — the third implementation of `WhatsAppBackend` (B-001).
 *
 * Baileys speaks the WhatsApp Web multi-device protocol over a WebSocket, with no browser.
 * That is the whole difference from the `web` backend, which drives a headless Chromium.
 *
 * **Unofficial, and no amount of code changes that.** It automates a WhatsApp Web session,
 * which Meta's terms do not sanction and which can get a number banned. Use a number created
 * for this, never a personal one. Prefer {@link WhatsAppCloudBackend} unless the number has
 * no Cloud API access.
 *
 * **Added rather than replacing**, for three reasons that a substitution would not give:
 * nobody loses a paired session (a Puppeteer profile and a multi-file auth state are not
 * interchangeable), the comparison against the incumbent becomes measurable rather than
 * asserted, and retreat stays cheap because nobody is forced onto it.
 *
 * @public
 */

import type {
  WhatsAppBackend,
  WhatsAppInboundEvent,
  WhatsAppOutboundMessage,
  WhatsAppSendResult,
  WhatsAppStatusReceipt,
} from "../../backend-types.js";
import { normalizeBaileysMessage } from "./normalize.js";
import {
  type BaileysSocketFactory,
  type BaileysSocketLike,
  createBaileysSocket,
} from "./socket.js";

/** How long to wait for the socket to report `open` before giving up. */
const DEFAULT_CONNECT_TIMEOUT_MS = 60_000;
/** How long to wait for one send to be acknowledged. */
const DEFAULT_SEND_TIMEOUT_MS = 30_000;

/** Construction options. @public */
export interface WhatsAppBaileysBackendOptions {
  /**
   * Directory holding the multi-file auth state — the pairing, persisted.
   *
   * Treat it like a credential: it is the session, and anyone holding it is the account.
   */
  readonly sessionDir: string;
  /** Give up on `connect()` after this long. Default 60s. */
  readonly connectTimeoutMs?: number;
  /** Give up on one send after this long. Default 30s. */
  readonly sendTimeoutMs?: number;
  /** Test seam: build the socket some other way. Production leaves it unset. */
  readonly socketFactory?: BaileysSocketFactory;
}

/**
 * A WhatsApp backend that speaks the multi-device protocol directly.
 *
 * No browser: where {@link WhatsAppWebBackend} drives a headless Chromium through
 * `whatsapp-web.js`, this holds a WebSocket. That is the whole difference in kind.
 *
 * **Unofficial, and no amount of code changes that.** It automates a WhatsApp Web session,
 * which Meta's terms do not sanction and which can get a number banned. Use a number created
 * for this and nothing else — never a personal one. Prefer the Cloud API backend unless the
 * number has no Cloud API access.
 *
 * `baileys` is an optional peer dependency, loaded lazily at connect, so a consumer who never
 * constructs this never needs it installed.
 *
 * @public
 */
export class WhatsAppBaileysBackend implements WhatsAppBackend {
  readonly kind = "baileys" as const;

  private socket?: BaileysSocketLike;
  private connected = false;
  /** Guards a concurrent second `connect()` from opening a second live session. */
  private connecting?: Promise<boolean>;
  private inboundHandler?: (event: WhatsAppInboundEvent) => Promise<void>;
  private statusHandler?: (receipt: WhatsAppStatusReceipt) => Promise<void>;
  /**
   * Serialises outbound sends (ADR D320).
   *
   * Both peer gateways studied do this, and one records that concurrent sends on a single
   * socket can misdeliver to the wrong chat. We have NOT measured that in our own code — we
   * have never run a Baileys socket — so this is precaution rather than a reproduction of our
   * own bug, and saying so is the point. It is kept because the cost is one promise chain and
   * the failure it guards against is a message delivered to the wrong person.
   */
  private sendQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: WhatsAppBaileysBackendOptions) {}

  /**
   * Open the socket and wait for it to report `open`.
   *
   * Idempotent, and safe against a concurrent second call: the in-flight promise is shared
   * rather than a second socket being built. WhatsApp's own adapter shipped without that
   * guard once and opened two live sessions.
   */
  async connect(): Promise<boolean> {
    if (this.connected) return true;
    if (this.connecting !== undefined) return this.connecting;

    this.connecting = this.openSocket();
    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  /** @internal */
  private async openSocket(): Promise<boolean> {
    const factory = this.opts.socketFactory ?? createBaileysSocket;
    const socket = await factory({ sessionDir: this.opts.sessionDir });
    this.socket = socket;

    socket.ev.on("messages.upsert", (payload) => {
      for (const raw of payload.messages ?? []) this.dispatchInbound(raw);
    });

    const timeoutMs = this.opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const opened = new Promise<boolean>((resolve) => {
      socket.ev.on("connection.update", (update) => {
        if (update.connection === "open") resolve(true);
        // A close before open is a failed connect; a close after is a dropped session, and
        // `connected` returning to false is what stops sends being attempted into nothing.
        if (update.connection === "close") {
          this.connected = false;
          resolve(false);
        }
      });
      // Never hanging matters more than succeeding: a caller has nothing to time out against
      // if this promise simply never settles.
      timer = setTimeout(() => resolve(false), timeoutMs);
    });

    try {
      this.connected = await opened;
      return this.connected;
    } finally {
      // The loser of the race stays scheduled otherwise, and a scheduled timer keeps Node's
      // event loop alive — the defect fixed in the core runner (#37).
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Close the socket. Idempotent, and safe when never connected. */
  async disconnect(): Promise<void> {
    this.connected = false;
    const socket = this.socket;
    this.socket = undefined;
    this.inboundHandler = undefined;
    this.statusHandler = undefined;
    if (socket === undefined) return;
    try {
      socket.end?.();
    } catch {
      // Tearing down a socket that is already gone is not a failure worth reporting; the
      // caller asked for it to be closed and it is closed.
    }
  }

  /**
   * Send one text message.
   *
   * Queued behind any send already in flight (D320), and raced against a timeout whose
   * expiry reports **undetermined** delivery rather than failure (D321). A local timeout says
   * the acknowledgement did not arrive, not that the message did not — so this never
   * retries, because a retry after a slow ack duplicates the message.
   */
  async send(message: WhatsAppOutboundMessage): Promise<WhatsAppSendResult> {
    const run = this.sendQueue.then(
      () => this.sendNow(message),
      () => this.sendNow(message),
    );
    // The chain must not inherit a rejection, or one failed send poisons every later one.
    this.sendQueue = run.catch(() => undefined);
    return run;
  }

  /** @internal */
  private async sendNow(message: WhatsAppOutboundMessage): Promise<WhatsAppSendResult> {
    const socket = this.socket;
    if (!this.connected || socket === undefined) {
      return {
        ok: false,
        error: { code: "server_error", message: "Baileys backend is not connected." },
      };
    }

    const jid = `${message.to}@${message.isGroup ? "g.us" : "s.whatsapp.net"}`;
    const timeoutMs = this.opts.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });

    try {
      const outcome = await Promise.race([
        socket.sendMessage(jid, { text: message.text }),
        timeout,
      ]);
      if (outcome === "timeout") {
        return {
          ok: false,
          error: {
            code: "timeout",
            message:
              `No acknowledgement after ${timeoutMs}ms — delivery is undetermined. ` +
              "Not retried: the message may already have been delivered.",
          },
        };
      }
      const wamid = outcome?.key?.id;
      return wamid !== undefined ? { ok: true, wamid } : { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "server_error",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Subscribe to inbound events. EC-H: a second call REPLACES the first. */
  onInbound(handler: (event: WhatsAppInboundEvent) => Promise<void>): () => void {
    this.inboundHandler = handler;
    return () => {
      if (this.inboundHandler === handler) this.inboundHandler = undefined;
    };
  }

  /**
   * Subscribe to delivery receipts. EC-H: a second call REPLACES the first.
   *
   * Declared for the interface; Baileys reports receipts on `messages.update`, which v1 does
   * not consume. Registering a handler is accepted and it is never called — stated here
   * rather than left for a consumer to discover from silence.
   */
  onStatusReceipt(handler: (receipt: WhatsAppStatusReceipt) => Promise<void>): () => void {
    this.statusHandler = handler;
    return () => {
      if (this.statusHandler === handler) this.statusHandler = undefined;
    };
  }

  /**
   * Normalise one envelope and hand it to the handler.
   *
   * The promise is floated because the Baileys listener is synchronous — but with a `catch`,
   * because a bare `void` on a rejecting promise ends the process under Node's default, which
   * is what killed two adapters in this package (#41). A handler is user code; its failure is
   * named as the handler's and delivery continues.
   *
   * @internal
   */
  private dispatchInbound(raw: unknown): void {
    const handler = this.inboundHandler;
    if (handler === undefined) return;
    const event = normalizeBaileysMessage(raw);
    if (event === undefined) return;
    void handler(event).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[whatsapp-baileys] handler threw: ${message}\n`);
    });
  }
}
