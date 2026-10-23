/**
 * `UrbitShipClient` — a ship's HTTP interface over `fetch`: `/~/login`, one Eyre channel with a
 * `chat` `/v3` subscription, its event stream, acks and pokes, and reconnection.
 *
 * The channel protocol follows OpenClaw's `extensions/tlon/src/urbit/sse-client.ts` at
 * `abd280635b` (Reported): actions are `PUT` to `/~/channel/<id>`, events are read from a `GET` of
 * the same URL, each frame's `data` is `{ id, response, ok | err, json }`.
 */

import { randomUUID } from "node:crypto";

import { TlonAuthError } from "./errors.js";
import { readSseFrames } from "./sse.js";
import type { FetchLike } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const POKE_TIMEOUT_MS = 30_000;
const FIRST_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const STABLE_STREAM_MS = 60_000;

/** The answer to {@link UrbitShipClient.poke}. */
export type PokeResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: "tlon_poke_failed" | "timeout" | "disconnected";
      readonly message: string;
    };

/** What the client needs. */
export interface ShipClientOptions {
  readonly shipUrl: string;
  /** The bot's ship, `~name`. */
  readonly ship: string;
  readonly code: string;
  readonly fetch: FetchLike;
  /** One `/v3` fact of the chat subscription. Must not throw. */
  readonly onFact: (fact: unknown) => void;
  /** The client stopped for good: the ship refused a re-login. */
  readonly onStopped: (err: Error) => void;
  /** How long `open()` waits for the login and the subscription ack. Default 10000 ms. */
  readonly timeoutMs?: number;
}

interface Frame {
  readonly id?: unknown;
  readonly response?: unknown;
  readonly ok?: unknown;
  readonly err?: unknown;
  readonly json?: unknown;
}

interface PendingPoke {
  readonly timer: ReturnType<typeof setTimeout>;
  readonly settle: (result: PokeResult) => void;
}

/** The client of one ship session. */
export class UrbitShipClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private cookie: string | undefined;
  private channelUrl: string | undefined;
  private nextActionId = 1;
  private subscriptionId: number | undefined;
  private subscribed: ((ok: boolean) => void) | undefined;
  private readonly pokes = new Map<number, PendingPoke>();
  private stream: AbortController | undefined;
  private streamOpenedAt: number | undefined;
  private nextDelayMs = FIRST_RECONNECT_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  /** Bumped by every `open()` and `close()`, so a session they overtook opens nothing. */
  private generation = 0;

  constructor(private readonly opts: ShipClientOptions) {
    this.baseUrl = opts.shipUrl.replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Log in, open a fresh channel subscribed to `chat` `/v3`, and read its stream. Answers `true`
   * on the subscription's ack and `false`, never a throw, on a refused login, an error ack or no
   * answer within the timeout.
   */
  async open(): Promise<boolean> {
    this.closed = false;
    this.generation += 1;
    const generation = this.generation;
    try {
      const ok = await withDeadline(this.session(generation), this.timeoutMs);
      if (!ok && generation === this.generation) this.close();
      return ok;
    } catch (err) {
      process.stderr.write(`[gateway-tlon-urbit] connect failed: ${messageOf(err)}\n`);
      if (generation === this.generation) this.close();
      return false;
    }
  }

  /** Poke `app` with `mark` and `json`; settles from the poke's own ack. Never throws. */
  async poke(app: string, mark: string, json: unknown): Promise<PokeResult> {
    if (this.closed || this.channelUrl === undefined) {
      return { ok: false, code: "disconnected", message: "the ship session is not open" };
    }
    const id = this.actionId();
    const answer = new Promise<PokeResult>((resolve) => {
      const timer = setTimeout(
        () =>
          settle({
            ok: false,
            code: "timeout",
            message: `no poke ack within ${POKE_TIMEOUT_MS} ms`,
          }),
        POKE_TIMEOUT_MS,
      );
      const settle = (result: PokeResult): void => {
        clearTimeout(timer);
        this.pokes.delete(id);
        resolve(result);
      };
      this.pokes.set(id, { timer, settle });
    });
    const status = await this.put([{ id, action: "poke", ship: this.opts.ship, app, mark, json }]);
    if (status !== undefined) {
      this.pokes.get(id)?.settle({ ok: false, code: "tlon_poke_failed", message: status });
    }
    return answer;
  }

  /** Stop reading, settle pending pokes as `disconnected` and clear every timer. Idempotent. */
  close(): void {
    this.closed = true;
    this.generation += 1;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.stream?.abort();
    this.stream = undefined;
    this.subscribed?.(false);
    this.subscribed = undefined;
    for (const pending of [...this.pokes.values()]) {
      pending.settle({ ok: false, code: "disconnected", message: "the ship session was closed" });
    }
  }

  private async session(generation: number): Promise<boolean> {
    await this.login();
    // Overtaken while the login was pending: open no channel for a session nobody wants.
    if (generation !== this.generation) return false;
    return this.subscribe(this.newChannel());
  }

  private async login(): Promise<void> {
    const response = await this.opts.fetch(`${this.baseUrl}/~/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: this.opts.code }).toString(),
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 401 || response.status === 403) {
      throw new TlonAuthError(`the ship refused the login code (HTTP ${response.status})`);
    }
    const cookie = response.headers.get("set-cookie");
    if (!response.ok || cookie === null) {
      throw new Error(`login answered HTTP ${response.status} with no session cookie`);
    }
    this.cookie = cookie.split(";")[0];
  }

  private newChannel(): string {
    this.channelUrl = `${this.baseUrl}/~/channel/${Date.now()}-${randomUUID().slice(0, 8)}`;
    return this.channelUrl;
  }

  /** Subscribe on `channel`, open its stream and wait for the subscription's ack. */
  private async subscribe(channel: string): Promise<boolean> {
    const id = this.actionId();
    this.subscriptionId = id;
    const acked = new Promise<boolean>((resolve) => {
      this.subscribed = resolve;
    });
    const refused = await this.put([
      { id, action: "subscribe", ship: this.opts.ship, app: "chat", path: "/v3" },
    ]);
    if (refused !== undefined) throw new Error(`subscribe was refused: ${refused}`);
    const status = await this.openStream(channel);
    if (status !== 200) throw new Error(`the event stream answered HTTP ${status}`);
    return acked;
  }

  /** `GET` the channel's stream and read it in the background; the status the ship answered. */
  private async openStream(channel: string): Promise<number> {
    if (this.closed) return 0;
    const controller = new AbortController();
    this.stream = controller;
    const response = await this.opts.fetch(channel, {
      method: "GET",
      headers: { ...this.headers(), accept: "text/event-stream" },
      signal: controller.signal,
    });
    if (response.status !== 200 || response.body === null) {
      await response.body?.cancel().catch(() => undefined);
      return response.status;
    }
    this.streamOpenedAt = Date.now();
    const body = response.body;
    readSseFrames(body, async (frame) => this.onFrame(frame.id, frame.data))
      .catch(() => undefined)
      .finally(() => this.onStreamEnd(controller));
    return 200;
  }

  private onFrame(eventId: number | undefined, data: string): void {
    this.dispatch(parseFrame(data));
    if (eventId !== undefined) {
      this.put([{ id: this.actionId(), action: "ack", "event-id": eventId }]).catch(
        () => undefined,
      );
    }
  }

  /** Route one frame: a subscription ack, a poke ack, or a fact of the chat subscription. */
  private dispatch(frame: Frame): void {
    const ownSubscription = frame.id === this.subscriptionId;
    if (frame.response === "quit" && ownSubscription) {
      this.resubscribe();
    } else if (frame.response === "subscribe" && ownSubscription) {
      this.subscribed?.(frame.ok !== undefined);
      this.subscribed = undefined;
    } else if (frame.response === "poke" && typeof frame.id === "number") {
      this.pokes.get(frame.id)?.settle(pokeResult(frame));
    } else if (frame.response === "diff" && ownSubscription) {
      this.opts.onFact(frame.json);
    }
  }

  /** The ship ended the chat subscription; ask for it again on the same channel. */
  private resubscribe(): void {
    const id = this.actionId();
    this.subscriptionId = id;
    this.put([{ id, action: "subscribe", ship: this.opts.ship, app: "chat", path: "/v3" }])
      .then((refused) => {
        if (refused !== undefined) {
          process.stderr.write(`[gateway-tlon-urbit] resubscribe refused: ${refused}\n`);
        }
      })
      .catch(() => undefined);
  }

  private onStreamEnd(controller: AbortController): void {
    if (this.stream !== controller) return;
    this.stream = undefined;
    if (this.closed) return;
    if (this.streamOpenedAt !== undefined && Date.now() - this.streamOpenedAt >= STABLE_STREAM_MS) {
      this.nextDelayMs = FIRST_RECONNECT_DELAY_MS;
    }
    this.streamOpenedAt = undefined;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const delay = this.nextDelayMs;
    this.nextDelayMs = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.boundedReconnect().catch((err: unknown) => {
        if (this.closed) return;
        if (err instanceof TlonAuthError) {
          this.close();
          this.opts.onStopped(err);
          return;
        }
        process.stderr.write(`[gateway-tlon-urbit] reconnect failed: ${messageOf(err)}\n`);
        this.scheduleReconnect();
      });
    }, delay);
  }

  /** {@link reconnect} within the timeout: a ship that never answers is another failed attempt. */
  private async boundedReconnect(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        this.stream?.abort();
        this.stream = undefined;
        reject(new Error(`no answer within ${this.timeoutMs} ms`));
      }, this.timeoutMs);
    });
    try {
      await Promise.race([this.reconnect(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Read the same channel again; the ship resends what was not acknowledged. A 404 means the ship
   * dropped the channel: a new one is opened and subscribed (EC-16). A 401 or 403 means the session
   * expired: the code logs in again, and a refusal of that is final.
   */
  private async reconnect(): Promise<void> {
    if (this.closed || this.channelUrl === undefined) return;
    let status = await this.openStream(this.channelUrl);
    if (status === 401 || status === 403) {
      await this.login();
      status = await this.openStream(this.channelUrl);
    }
    if (this.closed) return;
    if (status === 404) {
      const acked = await withDeadline(this.subscribe(this.newChannel()), this.timeoutMs);
      if (!acked) throw new Error("the new channel's subscription got no ack");
      return;
    }
    if (status !== 200) throw new Error(`the event stream answered HTTP ${status}`);
  }

  /** `PUT` actions to the channel; `undefined` on success, the failure otherwise. */
  private async put(actions: readonly unknown[]): Promise<string | undefined> {
    if (this.channelUrl === undefined) return "no channel";
    try {
      const response = await this.opts.fetch(this.channelUrl, {
        method: "PUT",
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify(actions),
      });
      await response.body?.cancel().catch(() => undefined);
      return response.ok ? undefined : `HTTP ${response.status}`;
    } catch (err) {
      return messageOf(err);
    }
  }

  private headers(): Record<string, string> {
    return this.cookie === undefined ? {} : { cookie: this.cookie };
  }

  private actionId(): number {
    const id = this.nextActionId;
    this.nextActionId += 1;
    return id;
  }
}

function parseFrame(data: string): Frame {
  try {
    return JSON.parse(data) as Frame;
  } catch {
    // A frame that is not JSON is acknowledged and otherwise ignored, so it cannot pin the channel.
    return {};
  }
}

function pokeResult(frame: Frame): PokeResult {
  if (frame.ok !== undefined) return { ok: true };
  return { ok: false, code: "tlon_poke_failed", message: String(frame.err ?? "the poke failed") };
}

/** `work`'s answer, or `false` once `ms` passes first. */
async function withDeadline(work: Promise<boolean>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
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
