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

/**
 * Close a socket without caring whether it was already gone.
 *
 * Tearing down something that has already closed is not a failure worth reporting: the
 * caller asked for it closed, and it is closed.
 */
function endQuietly(socket: BaileysSocketLike): void {
  try {
    socket.end?.();
  } catch {
    // Deliberately empty — see the docblock.
  }
}

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
  /**
   * Where the pairing QR goes, as often as WhatsApp reissues it.
   *
   * Defaults to stderr. It is exposed here because a host that is not a terminal — a service, a
   * container, a web app — has no way to read stderr back to the person holding the phone, and
   * without a route out the QR the session can never be paired.
   */
  readonly onQr?: (qr: string) => void;
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
  /**
   * Which connection attempt is current.
   *
   * Bumped by every `connect()` and every `disconnect()`. A socket from a superseded attempt
   * checks it before touching any state, which is what stops an abandoned socket delivering
   * inbound or flipping `connected` under a live one.
   */
  private generation = 0;
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
    // Every attempt carries a generation. A socket from an abandoned attempt must not be able
    // to speak for the backend afterwards — not to deliver inbound, not to flip `connected`,
    // and not to be left running (F2, F3).
    const generation = ++this.generation;
    const socket = await factory({
      sessionDir: this.opts.sessionDir,
      ...(this.opts.onQr !== undefined ? { onQr: this.opts.onQr } : {}),
    });

    const isCurrent = (): boolean => this.generation === generation;

    socket.ev.on("messages.upsert", (payload) => {
      // A batch typed anything other than `notify` is history being replayed, not live
      // traffic. Answering replayed history is the defect #11 records in the email backend.
      if (payload.type !== undefined && payload.type !== "notify") return;
      if (!isCurrent()) return;
      for (const raw of payload.messages ?? []) this.dispatchInbound(raw);
    });

    const timeoutMs = this.opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const opened = new Promise<boolean>((resolve) => {
      socket.ev.on("connection.update", (update) => {
        if (!isCurrent()) return;
        if (update.connection === "open") resolve(true);
        if (update.connection === "close") {
          this.connected = false;
          resolve(false);
        }
      });
      // Never hanging matters more than succeeding: a caller has nothing to time out against
      // if this promise simply never settles.
      timer = setTimeout(() => resolve(false), timeoutMs);
    });

    let opened_ok = false;
    try {
      opened_ok = await opened;
    } finally {
      // The loser of the race stays scheduled otherwise, and a scheduled timer keeps Node's
      // event loop alive — the defect fixed in the core runner (#37).
      if (timer !== undefined) clearTimeout(timer);
    }

    // A `disconnect()` that arrived while this was opening wins. Adopting the socket now
    // would leave `connected` true over a backend whose socket was already cleared, and every
    // later `connect()` would short-circuit on it while every `send` was refused — the
    // teardown-during-connect wedge fixed in the Slack adapter two commits before this one.
    if (!isCurrent()) {
      endQuietly(socket);
      return false;
    }

    if (!opened_ok) {
      // A failed attempt must not leave a live socket behind. It would keep feeding inbound
      // into the handler, and the retry would open a SECOND live session — which on an
      // unofficial automation is ban surface, not only a leak.
      //
      // Bumping the generation is what actually silences it: `end()` asks the socket to
      // close, and a fake — or a real one mid-teardown — can still emit. Retiring the
      // generation makes every listener from this attempt a no-op regardless.
      this.generation += 1;
      endQuietly(socket);
      this.socket = undefined;
      this.connected = false;
      return false;
    }

    this.socket = socket;
    this.connected = true;
    return true;
  }

  /** Close the socket. Idempotent, and safe when never connected. */
  async disconnect(): Promise<void> {
    // Bumping first is what makes an in-flight `connect()` lose: whatever it opens will see a
    // stale generation and tear itself down rather than adopting itself into a backend the
    // caller has already closed.
    this.generation += 1;
    this.connected = false;
    const socket = this.socket;
    this.socket = undefined;
    this.inboundHandler = undefined;
    this.statusHandler = undefined;
    if (socket !== undefined) endQuietly(socket);
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
    // The queue advances on the UNDERLYING send, not on what the caller is told.
    //
    // Chaining on the raced result looked right and broke the invariant it exists to keep: a
    // timeout returns to the caller while `socket.sendMessage` is still in flight — nothing
    // cancels it — so the next send started on a socket that already had one running. That is
    // precisely the concurrent-send hazard D320 exists to prevent, reached through D321.
    let settled: Promise<unknown> = Promise.resolve();
    const run = this.sendQueue.then(
      () => {
        const attempt = this.sendNow(message);
        settled = attempt.inFlight;
        return attempt.result;
      },
      () => {
        const attempt = this.sendNow(message);
        settled = attempt.inFlight;
        return attempt.result;
      },
    );
    this.sendQueue = run.then(
      () => settled.catch(() => undefined),
      () => settled.catch(() => undefined),
    );
    return run;
  }

  /**
   * Race one send against the send timeout.
   *
   * Separated so `sendNow` reads as the three outcomes it has — delivered, undetermined,
   * refused — rather than as promise plumbing.
   *
   * @internal
   */
  private async raceSend(
    inFlight: Promise<{ key?: { id?: string } } | undefined>,
    timeoutMs: number,
  ): Promise<{ key?: { id?: string } } | undefined | "timeout"> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    try {
      return await Promise.race([inFlight, timeout]);
    } finally {
      // The loser of the race stays scheduled otherwise, and a scheduled timer keeps Node's
      // event loop alive — the defect fixed in the core runner (#37).
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * One send attempt.
   *
   * Returns two promises deliberately. `result` is what the caller is told — it settles on
   * the timeout. `inFlight` settles when the socket is actually free again, which is what the
   * queue must wait for: a timeout does not cancel `sendMessage`, so releasing the queue on
   * the timeout would put two sends on one socket.
   *
   * @internal
   */
  private sendNow(message: WhatsAppOutboundMessage): {
    result: Promise<WhatsAppSendResult>;
    inFlight: Promise<unknown>;
  } {
    const socket = this.socket;
    if (!this.connected || socket === undefined) {
      return {
        result: Promise.resolve({
          ok: false,
          error: { code: "server_error", message: "Baileys backend is not connected." },
        }),
        inFlight: Promise.resolve(),
      };
    }

    const jid = `${message.to}@${message.isGroup ? "g.us" : "s.whatsapp.net"}`;
    const timeoutMs = this.opts.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
    const inFlight = socket.sendMessage(jid, { text: message.text });

    const result = this.raceSend(inFlight, timeoutMs)
      .then((outcome) => {
        if (outcome === "timeout") {
          return {
            ok: false,
            error: {
              code: "timeout" as const,
              message:
                `No acknowledgement after ${timeoutMs}ms — delivery is undetermined. ` +
                "Not retried: the message may already have been delivered.",
            },
          };
        }
        const wamid = outcome?.key?.id;
        return wamid !== undefined ? { ok: true, wamid } : { ok: true };
      })
      .catch((err: unknown) => ({
        ok: false,
        error: {
          code: "server_error" as const,
          message: err instanceof Error ? err.message : String(err),
        },
      }));

    return { result, inFlight };
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
