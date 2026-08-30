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

import { normalizeWhatsAppId } from "../../allowlist.js";
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
/**
 * How many of our own message ids to keep, as an echo guard.
 *
 * A window rather than a log: WhatsApp delivers our own message back within seconds or not at
 * all, so recognising one from an hour ago buys nothing and an unbounded set on a long-lived
 * socket is a leak.
 */
const SENT_WAMID_WINDOW = 256;

/**
 * What the pairing is doing, for a caller that must ASK rather than be told.
 *
 * {@link WhatsAppBaileysBackendOptions.onQr} is push: it fires when WhatsApp issues a code, at a
 * moment the caller does not choose. A screen is pull — it loads when someone opens it and has to
 * ask what is true right now. With only the callback, showing a QR anywhere means every consumer
 * keeping its own copy of the latest code and its own notion of whether pairing already succeeded,
 * which is this backend's bookkeeping copied into each of them.
 *
 * @public
 */
export interface WhatsAppPairingState {
  /**
   * `idle` before `connect()`, `awaiting_scan` while a code is outstanding, `connected` once the
   * socket opens, `closed` when it dies without a scan.
   */
  readonly status: "idle" | "awaiting_scan" | "connected" | "closed";
  /**
   * The most recent code, present only while `awaiting_scan`.
   *
   * WhatsApp reissues roughly every 20 seconds and the previous one stops working, so a screen
   * holding the old square shows something that cannot be scanned. It is cleared on `connected`
   * and on `closed` for the same reason: offering a code that leads nowhere is worse than
   * offering none.
   */
  readonly qr?: string;
  /** When that code arrived, so a UI can show its age instead of a stale square. */
  readonly qrAt?: number;
}

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
   * **QR IS THE ONLY WAY IN.** Baileys exposes `requestPairingCode`, and WhatsApp refuses the codes
   * this backend asks for — measured 2026-08-30 across three attempts, on both the 12- and 13-digit
   * forms of a Brazilian number. The reference implementation of this same transport documents the
   * same conclusion in one line ("Login is QR-only") while sending a custom `browser` triple exactly
   * as this one does, so the triple is NOT established as the cause and no cause is claimed here.
   * What is established is the outcome: a caller with no route to display a QR has no route to pair.
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
  /**
   * How to end a connection attempt that is still awaiting `open`.
   *
   * Retirement by generation makes an attempt's listeners silent, which is not the same as
   * making the attempt finish. One entry per in-flight attempt; `disconnect()` calls them so
   * the attempt settles now instead of at its timeout.
   */
  private readonly pendingAttempts = new Set<() => void>();
  /**
   * Why the socket last closed, as Baileys reported it.
   *
   * Kept because `connect()` returning `false` cannot distinguish a network blip from a
   * session the operator unlinked from their phone — and only one of those is worth retrying.
   * `rules/error-handling.md` § 3: fail clear, and log with enough context to act.
   */
  private lastCloseError?: unknown;
  /** The pairing, as a caller may ask for it. Never handed out mutable. */
  private pairingState: WhatsAppPairingState = { status: "idle" };

  /**
   * The JIDs that ARE this account, normalised. Empty until a socket reports who it logged in as.
   *
   * Empty means "not learned yet", and `isDispatchable` reads that as refusing everything this
   * account sent — the same behaviour as before self-chat support existed. A backend that
   * guessed here would answer in a stranger's conversation.
   */
  private selfJids: ReadonlySet<string> = new Set();

  /**
   * Ids this backend sent, most recent last. This is what stops the agent answering itself.
   *
   * Bounded because it is a loop guard, not a log: an unbounded set on a long-lived socket is a
   * leak, and nothing needs to recognise an echo from an hour ago — WhatsApp delivers our own
   * message back within seconds or not at all.
   */
  private sentWamids = new Set<string>();

  /** Record one id we sent, evicting the oldest once the window is full. @internal */
  private rememberSent(wamid: string): void {
    this.sentWamids.add(wamid);
    while (this.sentWamids.size > SENT_WAMID_WINDOW) {
      const oldest = this.sentWamids.values().next();
      if (oldest.done === true) break;
      this.sentWamids.delete(oldest.value);
    }
  }

  /**
   * Learn which JIDs are this account, from the socket that just logged in.
   *
   * Both forms are recorded: the phone JID and the LID. The self-chat is addressed by LID —
   * measured on a real account, where a note-to-self arrived on `231116569108705@lid` while the
   * account's phone JID was `553598838687` — so recording only one leaves the self-chat
   * unrecognised and the feature silently off.
   *
   * @internal
   */
  private learnSelfJids(socket: BaileysSocketLike): void {
    const user = socket.user;
    const ids = [user?.id, user?.lid]
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .map((id) => normalizeWhatsAppId(id))
      .filter((id) => id.length > 0);
    this.selfJids = new Set(ids);
    if (process.env.THEOKIT_WHATSAPP_TRACE === "1") {
      // Whether the real library populates `user` at all is the one thing a fake socket cannot
      // answer, and an empty set here means self-notes are refused with nothing logged.
      process.stderr.write(
        `[whatsapp-baileys][trace] selfJids learned: ${ids.length === 0 ? "(none)" : ids.join(", ")}\n`,
      );
    }
  }
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

    const attempt = this.openSocket();
    this.connecting = attempt;
    try {
      return await attempt;
    } finally {
      // Only clear what is still ours. `disconnect()` clears it too, and a later `connect()`
      // may already have installed its own — a bare assignment here would erase that one and
      // let a third caller open a parallel socket.
      if (this.connecting === attempt) this.connecting = undefined;
    }
  }

  /** @internal */
  private async openSocket(): Promise<boolean> {
    // Every attempt carries a generation. A socket from an abandoned attempt must not be able
    // to speak for the backend afterwards — not to deliver inbound, not to flip `connected`,
    // and not to be left running.
    const generation = ++this.generation;
    const socket = await this.buildSocket();
    const isCurrent = (): boolean => this.generation === generation;

    // A `disconnect()` that landed while the factory was still resolving cannot see this
    // attempt: it is not yet in `pendingAttempts` and `this.socket` is still undefined, so the
    // teardown ends nothing. The window is not theoretical — the real factory awaits a dynamic
    // import, the auth state off disk and a network round-trip for the protocol version before
    // a socket exists. Without this check, stop-then-start in that window left a live session
    // running until the connect timeout fired.
    if (!isCurrent()) {
      endQuietly(socket);
      return false;
    }

    this.subscribeInbound(socket, isCurrent);
    const timeoutMs = this.opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const openedOk = await this.raceOpen(socket, isCurrent, timeoutMs);

    // A `disconnect()` that arrived while this was opening wins. Adopting the socket now would
    // leave `connected` true over a backend whose socket was already cleared, and every later
    // `connect()` would short-circuit on it while every `send` was refused — the
    // teardown-during-connect wedge fixed in the Slack adapter.
    if (!isCurrent()) {
      endQuietly(socket);
      return false;
    }

    if (!openedOk) {
      this.reportConnectFailure(timeoutMs);
      // A failed attempt must not leave a live socket behind. It would keep feeding inbound
      // into the handler, and the retry would open a SECOND live session — which on an
      // unofficial automation is ban surface, not only a leak.
      //
      // Bumping the generation is what actually silences it: `end()` asks the socket to close,
      // and a socket mid-teardown can still emit. Retiring the generation makes every listener
      // from this attempt a no-op regardless.
      this.generation += 1;
      endQuietly(socket);
      this.socket = undefined;
      this.connected = false;
      return false;
    }

    // Nothing should still be here, but a socket that closed and was replaced without going
    // through the close branch would be stranded by this assignment — and a stranded Baileys
    // socket is a live session, not an unreferenced object.
    if (this.socket !== undefined && this.socket !== socket) endQuietly(this.socket);
    this.socket = socket;
    this.learnSelfJids(socket);
    this.connected = true;
    return true;
  }

  /**
   * What the pairing is doing right now.
   *
   * Read it as often as a screen needs; it is a snapshot, not a subscription.
   */
  get pairing(): WhatsAppPairingState {
    return this.pairingState;
  }

  /** Build a socket through the injected factory, or the real one. @internal */
  private async buildSocket(): Promise<BaileysSocketLike> {
    const factory = this.opts.socketFactory ?? createBaileysSocket;
    return factory({
      sessionDir: this.opts.sessionDir,
      // ALWAYS supplied, even when the caller wants none: a backend that only forwards cannot
      // answer `pairing`, and the caller's own handler still runs, so wiring one costs nothing.
      onQr: (qr: string) => {
        this.pairingState = { status: "awaiting_scan", qr, qrAt: Date.now() };
        this.opts.onQr?.(qr);
      },
    });
  }

  /**
   * Trace one inbound batch BEFORE any filter, when `THEOKIT_WHATSAPP_TRACE=1`.
   *
   * Two independent filters can discard an envelope — the batch `type` here and `fromMe` inside
   * `normalizeBaileysMessage` — and from outside, both look identical: nothing happens. Telling
   * them apart by reading the code is guessing; this is how you find out which one fired.
   *
   * Deliberately content-free. A Baileys session pairs a REAL account carrying real
   * conversations, so the trace records shape (type, direction, group, has-text) and the last
   * four digits of the jid, never the message and never a full contact number.
   *
   * @internal
   */
  private traceBatch(payload: { type?: string; messages?: unknown[] }): void {
    if (process.env.THEOKIT_WHATSAPP_TRACE !== "1") return;
    const messages = payload.messages ?? [];
    const rows = messages.map((raw) => {
      const key = (raw as { key?: Record<string, unknown> } | undefined)?.key ?? {};
      const jid = typeof key.remoteJid === "string" ? key.remoteJid : "";
      const message = (raw as { message?: unknown } | undefined)?.message;
      return [
        `fromMe=${String(key.fromMe === true)}`,
        `jid=…${jid.replace(/\D/g, "").slice(-4)}`,
        `group=${String(jid.endsWith("@g.us"))}`,
        `hasMessage=${String(message !== null && message !== undefined)}`,
      ].join(" ");
    });
    process.stderr.write(
      `[whatsapp-baileys][trace] upsert type=${payload.type ?? "(none)"} n=${messages.length}` +
        (rows.length === 0 ? "\n" : `\n  ${rows.join("\n  ")}\n`),
    );
  }

  /** Route this socket's inbound batches into the handler, while it is still current. @internal */
  private subscribeInbound(socket: BaileysSocketLike, isCurrent: () => boolean): void {
    socket.ev.on("messages.upsert", (payload) => {
      this.traceBatch(payload as { type?: string; messages?: unknown[] });
      // A batch typed anything other than `notify` is history being replayed, not live
      // traffic. Answering replayed history is the defect #11 records in the email backend.
      if (payload.type !== undefined && payload.type !== "notify") return;
      if (!isCurrent()) return;
      for (const raw of payload.messages ?? []) this.dispatchInbound(raw);
    });
  }

  /**
   * Wait for this socket to report `open`, or for something to end the attempt.
   *
   * Three things can settle it: the socket opens, the socket closes, or the timeout fires — and
   * a fourth, `disconnect()`, reaches it through `pendingAttempts`. That last one is why the
   * resolver is registered rather than merely closed over: retiring an attempt by generation
   * makes its listeners no-ops, INCLUDING the one that would settle this, so without a way in
   * from outside the only thing left able to finish it was the timeout.
   *
   * @internal
   */
  private async raceOpen(
    socket: BaileysSocketLike,
    isCurrent: () => boolean,
    timeoutMs: number,
  ): Promise<boolean> {
    // The executor runs synchronously, so `settle` is assigned before the next statement.
    let settle: (ok: boolean) => void = () => undefined;
    const opened = new Promise<boolean>((resolve) => {
      settle = resolve;
    });

    const abandon = (): void => settle(false);
    this.pendingAttempts.add(abandon);

    socket.ev.on("connection.update", (update) => {
      if (!isCurrent()) return;
      if (update.connection === "open") {
        // The code is dropped, not kept: a scanned QR is spent, and a UI holding it would offer
        // something that no longer pairs anything.
        this.pairingState = { status: "connected" };
        settle(true);
        return;
      }
      if (update.connection !== "close") return;
      this.lastCloseError = update.lastDisconnect?.error;
      this.connected = false;
      this.pairingState = { status: "closed" };
      // A closed socket is finished, and Baileys carries its own reconnect machinery: left
      // alone it keeps dialling under a backend that believes it is disconnected. Clearing the
      // reference too is what stops the next `connect()` overwriting it and stranding this one
      // beyond the reach of any later `disconnect()`.
      if (this.socket === socket) this.socket = undefined;
      endQuietly(socket);
      settle(false);
    });

    // Never hanging matters more than succeeding: a caller has nothing to time out against if
    // this promise simply never settles.
    const timer = setTimeout(() => settle(false), timeoutMs);
    try {
      return await opened;
    } finally {
      // The loser of the race stays scheduled otherwise, and a scheduled timer keeps Node's
      // event loop alive — the defect fixed in the core runner (#37).
      clearTimeout(timer);
      this.pendingAttempts.delete(abandon);
    }
  }

  /**
   * Say why the connection did not open.
   *
   * A bare `false` tells an operator nothing, and the two causes want opposite responses: a
   * blip is worth retrying, an unlinked device can only be fixed by re-pairing, and a
   * supervisor that cannot tell them apart retries forever against a dead session.
   *
   * @internal
   */
  private reportConnectFailure(timeoutMs: number): void {
    const error = this.lastCloseError;
    const cause =
      error === undefined
        ? `no 'open' within ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error);
    process.stderr.write(`[whatsapp-baileys] connect failed: ${cause}\n`);
  }

  /** Close the socket. Idempotent, and safe when never connected. */
  async disconnect(): Promise<void> {
    // Bumping first is what makes an in-flight `connect()` lose: whatever it opens will see a
    // stale generation and tear itself down rather than adopting itself into a backend the
    // caller has already closed.
    this.generation += 1;
    this.connected = false;
    // Without this the guard in `connect()` hands the next caller the promise of the attempt
    // this call just doomed: it opens nothing, waits out that attempt's timeout, and returns
    // false. A supervisor doing stop-then-start reads that as an unexplained failure.
    this.connecting = undefined;
    for (const abandon of this.pendingAttempts) abandon();
    this.pendingAttempts.clear();
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
          error: { code: "not_connected", message: "Baileys backend is not connected." },
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
        if (wamid !== undefined) this.rememberSent(wamid);
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
    const event = normalizeBaileysMessage(raw, {
      selfJids: this.selfJids,
      sentWamids: this.sentWamids,
    });
    if (event === undefined) return;
    void handler(event).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[whatsapp-baileys] handler threw: ${message}\n`);
    });
  }
}
