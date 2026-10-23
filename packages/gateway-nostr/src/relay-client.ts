/**
 * `NostrRelayClient` — one WebSocket per relay, with the relay protocol of NIP-01 and the
 * authentication of NIP-42, and nothing about direct messages.
 *
 * It is a public export because two adapters sit on it: this package's `NostrAdapter` and the
 * Buzz adapter of B-367 (plan ADR D4). Its surface is kept to `open`, `subscribe`, `publish`,
 * `close` and the `signAuth` option for that reason.
 *
 * @module
 */

import { randomUUID } from "node:crypto";

import type { Filter } from "nostr-tools/filter";
import type { NostrEvent } from "nostr-tools/pure";

import { isEvent, messageOf, parseFrame, resubscribeFilters } from "./relay-frames.js";
import { SeenIds } from "./seen-ids.js";

const LABEL = "gateway-nostr";
const DEFAULT_TIMEOUT_MS = 10_000;
const PUBLISH_TIMEOUT_MS = 30_000;
const FIRST_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const STABLE_CONNECTION_MS = 60_000;
const AUTH_REQUIRED = "auth-required:";

/**
 * The part of a WebSocket the client uses. Node's global `WebSocket` and the `ws` package both
 * have this shape.
 *
 * @public
 */
export interface NostrSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((message: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

/**
 * Opens one socket to one relay URL.
 *
 * @public
 */
export type NostrSocketFactory = (url: string) => NostrSocket;

/**
 * Options of {@link NostrRelayClient}.
 *
 * @public
 */
export interface NostrRelayClientOptions {
  /** The relay URLs, each `ws:` or `wss:`. At least one. */
  readonly relays: readonly string[];
  /**
   * Signs the NIP-42 `AUTH` event (kind 22242, with `relay` and `challenge` tags) a relay asks for.
   * The client never holds a secret key itself.
   */
  readonly signAuth: (challenge: string, relay: string) => Promise<NostrEvent>;
  /** Opens a socket. Defaults to Node's global `WebSocket`. */
  readonly socketFactory?: NostrSocketFactory;
  /** How long a subscription waits for `EOSE`, and a relay for its `AUTH` answer. Default 10000 ms. */
  readonly timeoutMs?: number;
}

/**
 * The answer to {@link NostrRelayClient.publish}.
 *
 * `relay_rejected` carries the last relay's own message; `timeout` means no relay answered within
 * 30000 ms; `disconnected` means no relay was open, or the client closed first.
 *
 * @public
 */
export type NostrPublishResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: "relay_rejected" | "timeout" | "disconnected";
      readonly message: string;
    };

/**
 * A relay list the client cannot use: empty, or holding a URL that is not `ws:` or `wss:`.
 *
 * @public
 */
export class NostrRelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NostrRelayError";
  }
}

interface Relay {
  readonly url: string;
  socket: NostrSocket | undefined;
  open: boolean;
  openedAt: number | undefined;
  nextDelayMs: number;
  reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  challenge: string | undefined;
  authInFlight: boolean;
  authed: boolean;
  authEventId: string | undefined;
  authTimer: ReturnType<typeof setTimeout> | undefined;
  authAttempt: symbol | undefined;
}

interface Subscription {
  readonly filters: readonly Filter[];
  readonly onEvent: (event: NostrEvent, relay: string) => void;
  lastSeen: number | undefined;
  answer: ((ok: boolean) => void) | undefined;
}

interface PendingPublish {
  /** What every caller publishing this event id while it is pending receives. */
  result: Promise<NostrPublishResult>;
  readonly event: NostrEvent;
  readonly sentTo: Set<string>;
  readonly refused: Map<string, string>;
  readonly awaitingAuth: Set<string>;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly settle: (result: NostrPublishResult) => void;
}

const defaultSocketFactory: NostrSocketFactory = (url) =>
  new WebSocket(url) as unknown as NostrSocket;

/**
 * A pool of relay connections.
 *
 * Events arriving on several relays reach `onEvent` once (a bounded set of 1000 seen ids). A relay
 * that drops is reopened after 1000 ms, doubling to 30000 ms, and the delay starts again at 1000 ms
 * after a connection that stayed up 60000 ms. A relay that asks for NIP-42 `AUTH` gets an event
 * from `signAuth`, and only once it answers `OK true` for it are its subscriptions and the events
 * it refused with `auth-required:` sent again.
 *
 * @public
 */
export class NostrRelayClient {
  private readonly relays: Relay[];
  private readonly socketFactory: NostrSocketFactory;
  private readonly timeoutMs: number;
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly pending = new Map<string, PendingPublish>();
  private readonly seen = new SeenIds();
  private readonly openWaiters = new Set<() => void>();
  private closed = false;

  /** @throws NostrRelayError when `relays` is empty or holds a URL that is not `ws:` or `wss:` */
  constructor(private readonly opts: NostrRelayClientOptions) {
    if (opts.relays.length === 0) throw new NostrRelayError("relays must name at least one relay");
    for (const url of opts.relays) {
      if (!/^wss?:\/\//.test(url)) {
        throw new NostrRelayError(`relay ${JSON.stringify(url)} is not a ws: or wss: URL`);
      }
    }
    this.relays = opts.relays.map((url) => ({
      url,
      socket: undefined,
      open: false,
      openedAt: undefined,
      nextDelayMs: FIRST_RECONNECT_DELAY_MS,
      reconnectTimer: undefined,
      challenge: undefined,
      authInFlight: false,
      authed: false,
      authEventId: undefined,
      authTimer: undefined,
      authAttempt: undefined,
    }));
    this.socketFactory = opts.socketFactory ?? defaultSocketFactory;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Open one socket per relay; resolves once each has opened or failed. A failed relay is retried. */
  async open(): Promise<void> {
    this.closed = false;
    const idle = this.relays.filter(
      (relay) => relay.socket === undefined && relay.reconnectTimer === undefined,
    );
    const attempts = Promise.all(idle.map((relay) => this.connectRelay(relay)));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop: () => void = () => undefined;
    const deadline = new Promise<void>((resolve) => {
      stop = resolve;
      timer = setTimeout(resolve, this.timeoutMs);
    });
    this.openWaiters.add(stop);
    await Promise.race([attempts, deadline]);
    clearTimeout(timer);
    this.openWaiters.delete(stop);
  }

  /**
   * Send `REQ` with `filters` to every relay, now and after each reconnect.
   *
   * @returns `true` on the first `EOSE` from any relay, `false` when none arrives within the
   *   timeout. Events keep reaching `onEvent` either way.
   */
  subscribe(
    filters: readonly Filter[],
    onEvent: (event: NostrEvent, relay: string) => void,
  ): Promise<boolean> {
    const id = randomUUID().replaceAll("-", "").slice(0, 16);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => answer(false), this.timeoutMs);
      const answer = (ok: boolean): void => {
        clearTimeout(timer);
        subscription.answer = undefined;
        resolve(ok);
      };
      const subscription: Subscription = { filters, onEvent, lastSeen: undefined, answer };
      this.subscriptions.set(id, subscription);
      for (const relay of this.openRelays()) this.sendReq(relay, id, subscription);
    });
  }

  /** Send `event` to every open relay; settles on the first `OK true`. Never throws. */
  publish(event: NostrEvent): Promise<NostrPublishResult> {
    const inFlight = this.pending.get(event.id);
    if (inFlight !== undefined) return inFlight.result;
    const open = this.openRelays();
    if (this.closed || open.length === 0) {
      return Promise.resolve({ ok: false, code: "disconnected", message: "no relay is connected" });
    }
    let entry: PendingPublish | undefined;
    const result = new Promise<NostrPublishResult>((resolve) => {
      const timer = setTimeout(
        () =>
          settle({
            ok: false,
            code: "timeout",
            message: `no relay answered within ${PUBLISH_TIMEOUT_MS} ms`,
          }),
        PUBLISH_TIMEOUT_MS,
      );
      const settle = (result: NostrPublishResult): void => {
        clearTimeout(timer);
        this.pending.delete(event.id);
        resolve(result);
      };
      entry = {
        result: Promise.resolve({ ok: false, code: "disconnected", message: "not sent yet" }),
        event,
        sentTo: new Set(open.map((relay) => relay.url)),
        refused: new Map(),
        awaitingAuth: new Set(),
        timer,
        settle,
      };
      this.pending.set(event.id, entry);
      for (const relay of open) send(relay, ["EVENT", event]);
    });
    if (entry !== undefined) entry.result = result;
    return result;
  }

  /** Close every socket, settle what is pending and clear every timer. Idempotent. */
  close(): void {
    this.closed = true;
    for (const relay of this.relays) {
      clearTimeout(relay.reconnectTimer);
      clearTimeout(relay.authTimer);
      const socket = relay.socket;
      relay.socket = undefined;
      relay.open = false;
      socket?.close();
    }
    for (const entry of [...this.pending.values()]) {
      entry.settle({ ok: false, code: "disconnected", message: "the relay client was closed" });
    }
    for (const subscription of this.subscriptions.values()) subscription.answer?.(false);
    this.subscriptions.clear();
    for (const stop of this.openWaiters) stop();
    this.openWaiters.clear();
  }

  private openRelays(): Relay[] {
    return this.relays.filter((relay) => relay.open);
  }

  private connectRelay(relay: Relay): Promise<void> {
    return new Promise<void>((resolve) => {
      let socket: NostrSocket;
      try {
        socket = this.socketFactory(relay.url);
      } catch (err) {
        process.stderr.write(`[${LABEL}] cannot open ${relay.url}: ${messageOf(err)}\n`);
        this.scheduleReconnect(relay);
        resolve();
        return;
      }
      relay.socket = socket;
      socket.onopen = () => {
        if (relay.socket !== socket) return;
        relay.open = true;
        relay.openedAt = Date.now();
        relay.authed = false;
        relay.challenge = undefined;
        for (const [id, subscription] of this.subscriptions) this.sendReq(relay, id, subscription);
        resolve();
      };
      socket.onmessage = (message) => {
        if (relay.socket === socket) this.onFrame(relay, message.data);
      };
      socket.onerror = () => undefined;
      socket.onclose = () => {
        if (relay.socket !== socket) return;
        this.onDrop(relay);
        resolve();
      };
    });
  }

  private onDrop(relay: Relay): void {
    relay.socket = undefined;
    relay.open = false;
    relay.authInFlight = false;
    relay.authEventId = undefined;
    relay.authAttempt = undefined;
    clearTimeout(relay.authTimer);
    if (!this.closed) this.scheduleReconnect(relay);
  }

  private scheduleReconnect(relay: Relay): void {
    if (relay.openedAt !== undefined && Date.now() - relay.openedAt >= STABLE_CONNECTION_MS) {
      relay.nextDelayMs = FIRST_RECONNECT_DELAY_MS;
    }
    relay.openedAt = undefined;
    const delay = relay.nextDelayMs;
    relay.nextDelayMs = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
    relay.reconnectTimer = setTimeout(() => {
      relay.reconnectTimer = undefined;
      if (this.closed) return;
      this.connectRelay(relay).catch((err: unknown) => {
        process.stderr.write(`[${LABEL}] reconnect to ${relay.url} failed: ${messageOf(err)}\n`);
      });
    }, delay);
  }

  private sendReq(relay: Relay, id: string, subscription: Subscription): void {
    send(relay, ["REQ", id, ...resubscribeFilters(subscription.filters, subscription.lastSeen)]);
  }

  private onFrame(relay: Relay, data: unknown): void {
    const frame = parseFrame(data);
    if (frame === undefined) return;
    switch (frame[0]) {
      case "EVENT":
        this.onEvent(relay, frame[1], frame[2]);
        return;
      case "EOSE":
        if (typeof frame[1] === "string") this.subscriptions.get(frame[1])?.answer?.(true);
        return;
      case "OK":
        this.onOk(relay, frame[1], frame[2] === true, typeof frame[3] === "string" ? frame[3] : "");
        return;
      case "AUTH":
        if (typeof frame[1] === "string") this.startAuth(relay, frame[1]);
        return;
      case "CLOSED":
        this.onClosed(relay, frame[1], frame[2]);
        return;
      default:
        return;
    }
  }

  private onEvent(relay: Relay, id: unknown, event: unknown): void {
    if (typeof id !== "string" || !isEvent(event)) return;
    const subscription = this.subscriptions.get(id);
    if (subscription === undefined) return;
    subscription.lastSeen = Math.max(subscription.lastSeen ?? 0, event.created_at);
    if (!this.seen.add(event.id)) return;
    subscription.onEvent(event, relay.url);
  }

  /**
   * A relay ended a subscription. `auth-required:` is answered by the AUTH flow, which sends the
   * subscription again once the relay accepts; any other reason is logged, since the relay will not
   * deliver that subscription again until it reconnects.
   */
  private onClosed(relay: Relay, id: unknown, reason: unknown): void {
    const why = typeof reason === "string" ? reason : "";
    if (typeof id !== "string" || why.startsWith(AUTH_REQUIRED)) return;
    process.stderr.write(`[${LABEL}] ${relay.url} closed subscription ${id}: ${why}\n`);
  }

  private onOk(relay: Relay, id: unknown, accepted: boolean, message: string): void {
    if (typeof id !== "string") return;
    if (id === relay.authEventId) {
      this.onAuthAnswer(relay, accepted);
      return;
    }
    const entry = this.pending.get(id);
    if (entry === undefined) return;
    if (accepted) {
      entry.settle({ ok: true });
    } else if (message.startsWith(AUTH_REQUIRED) && !relay.authed) {
      entry.awaitingAuth.add(relay.url);
      if (relay.challenge !== undefined && !relay.authInFlight && !relay.authed) {
        this.startAuth(relay, relay.challenge);
      }
    } else {
      this.refuse(entry, relay.url, message);
    }
  }

  private startAuth(relay: Relay, challenge: string): void {
    relay.challenge = challenge;
    if (relay.authInFlight) return;
    relay.authInFlight = true;
    // One token per attempt: an answer from an attempt that already ended, on this connection or an
    // earlier one, must not end the attempt in progress.
    const attempt = Symbol("auth attempt");
    relay.authAttempt = attempt;
    const current = (): boolean => relay.authAttempt === attempt;
    // Armed before signing, so a signer that never answers is a refusal too.
    relay.authTimer = setTimeout(() => {
      if (current()) this.onAuthAnswer(relay, false);
    }, this.timeoutMs);
    this.opts
      .signAuth(challenge, relay.url)
      .then((auth) => {
        if (!current()) return;
        relay.authEventId = auth.id;
        send(relay, ["AUTH", auth]);
      })
      .catch((err: unknown) => {
        if (!current()) return;
        process.stderr.write(`[${LABEL}] signAuth failed for ${relay.url}: ${messageOf(err)}\n`);
        this.onAuthAnswer(relay, false);
      });
  }

  private onAuthAnswer(relay: Relay, accepted: boolean): void {
    relay.authAttempt = undefined;
    clearTimeout(relay.authTimer);
    relay.authTimer = undefined;
    relay.authEventId = undefined;
    relay.authInFlight = false;
    const waiting = [...this.pending.values()].filter((entry) => entry.awaitingAuth.has(relay.url));
    for (const entry of waiting) entry.awaitingAuth.delete(relay.url);
    if (!accepted) {
      const onRelay = [...this.pending.values()].filter((entry) => entry.sentTo.has(relay.url));
      for (const entry of onRelay) this.refuse(entry, relay.url, `${relay.url} refused AUTH`);
      return;
    }
    relay.authed = true;
    for (const [id, subscription] of this.subscriptions) this.sendReq(relay, id, subscription);
    for (const entry of waiting) send(relay, ["EVENT", entry.event]);
  }

  /** Record one relay's refusal; settles `relay_rejected` once every relay sent to has refused. */
  private refuse(entry: PendingPublish, url: string, message: string): void {
    entry.refused.set(url, message);
    if ([...entry.sentTo].every((sent) => entry.refused.has(sent))) {
      entry.settle({ ok: false, code: "relay_rejected", message });
    }
  }
}

function send(relay: Relay, frame: readonly unknown[]): void {
  relay.socket?.send(JSON.stringify(frame));
}
