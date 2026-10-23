/**
 * `TlonUrbitAdapter` — `BasePlatformAdapter` over a ship's HTTP interface: DMs read from the
 * `chat` app's `/v3` subscription, replies poked to `chat` with `chat-dm-action`.
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

import { SeenIds } from "./seen-ids.js";
import { UrbitShipClient } from "./ship-client.js";
import type { FetchLike, TlonUrbitAdapterOptions } from "./types.js";
import { type ChatFact, dmPoke, normalizeShip, readChatFact, rsvpPoke } from "./wire.js";

const LABEL = "gateway-tlon-urbit";
const SHIP = /^~[a-z]+(-[a-z]+)*$/;

/**
 * Tlon adapter for one bot ship.
 *
 * `connect()` logs in with the ship's `+code`, opens a fresh channel subscribed to `chat` at `/v3`
 * and answers `true` on the subscription's ack; it answers `false`, never a throw, when the login is
 * refused or nothing answers within `connectTimeoutMs`. Each DM essay from another ship becomes one
 * `TlonUrbitMessageEvent` (the last 1000 message ids are remembered, so what the ship resends after
 * a reconnect is not answered twice), and a DM invite is accepted. The stream reconnects on its
 * own; a re-login the ship refuses stops it, logged as `TlonAuthError`.
 *
 * @public
 */
export class TlonUrbitAdapter extends BasePlatformAdapter {
  readonly platform = "tlon_urbit" as const;
  private readonly ship: string;
  private readonly client: UrbitShipClient;
  private readonly seen = new SeenIds();
  /** Ships whose invite was accepted while they remain in the `/v3` invite list. */
  private accepted = new Set<string>();
  private handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private connected = false;
  private connecting: Promise<boolean> | undefined;
  private lastSentAt: number | undefined;
  /** Bumped by `disconnect()`, so a connect it overtook does not report connected. */
  private generation = 0;
  private warnedAboutHtml = false;

  constructor(opts: TlonUrbitAdapterOptions) {
    super();
    // `zod` and `~zod` name one ship; without the sig the bot's own essays would not match (EC-14).
    this.ship = normalizeShip(opts.ship);
    const fetchFn: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
    this.client = new UrbitShipClient({
      shipUrl: opts.shipUrl,
      ship: this.ship,
      code: opts.code,
      fetch: fetchFn,
      onFact: (fact) => this.onFact(fact),
      onStopped: (err) => this.onStopped(err),
      ...(opts.connectTimeoutMs === undefined ? {} : { timeoutMs: opts.connectTimeoutMs }),
    });
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    if (this.connecting !== undefined) return this.connecting;
    const attempt = this.openSession().finally(() => {
      if (this.connecting === attempt) this.connecting = undefined;
    });
    this.connecting = attempt;
    return attempt;
  }

  async disconnect(): Promise<void> {
    this.generation += 1;
    this.connected = false;
    this.connecting = undefined;
    this.client.close();
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "outbound text is empty" } };
    }
    if (!this.connected) {
      return {
        ok: false,
        error: { code: "not_connected", message: "TlonUrbitAdapter.connect() has not succeeded" },
      };
    }
    const recipient = normalizeShip(out.channel.id);
    if (!SHIP.test(recipient)) {
      return {
        ok: false,
        error: {
          code: "invalid_channel",
          message: `channel.id must be a ship name, ~sampel-palnet, got ${JSON.stringify(out.channel.id)}`,
        },
      };
    }
    const poke = dmPoke(this.ship, recipient, this.textFor(out), Date.now(), this.lastSentAt);
    this.lastSentAt = poke.sentAt;
    const result = await this.client.poke("chat", "chat-dm-action", poke.json);
    if (result.ok) return { ok: true, messageId: poke.messageId };
    return { ok: false, error: { code: result.code, message: result.message } };
  }

  onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    // Replace, not stack.
    this.handler = handler;
    return () => {
      if (this.handler === handler) {
        this.handler = undefined;
      }
    };
  }

  /** Deliver an event that arrived out of band, through `runHandler`. */
  override async deliver(
    event: GatewayMessageEvent,
  ): Promise<"ok" | "no_handler" | "handler_threw"> {
    return this.runHandler(this.handler, event);
  }

  private async openSession(): Promise<boolean> {
    const generation = this.generation;
    const ok = await this.client.open();
    // A disconnect() while the session opened closed the client; its answer no longer counts.
    if (generation !== this.generation) return false;
    this.connected = ok;
    return ok;
  }

  /** The text to send: markdown loses its markers, html goes as is with one warning. */
  private textFor(out: OutboundMessage): string {
    if (out.format === "markdown") return channelRendering(this.platform).translate(out.text);
    if (out.format === "html" && !this.warnedAboutHtml) {
      this.warnedAboutHtml = true;
      process.stderr.write(
        `[${LABEL}] format="html" was declared and a Tlon DM is sent as plain inline text; sending the text unchanged. Logged once.\n`,
      );
    }
    return out.text;
  }

  private onFact(raw: unknown): void {
    const fact = readChatFact(raw);
    if (fact.kind === "invites") {
      this.acceptInvites(fact.ships);
      return;
    }
    if (fact.kind !== "essay") return;
    // A club (group DM) names the conversation, and its author is whatever the sending ship wrote:
    // only a DM from a ship carries an identity this adapter can stand behind.
    if (!SHIP.test(fact.whom) || fact.text === "") return;
    if (fact.author === this.ship || this.seen.has(fact.id)) return;
    this.seen.add(fact.id);
    void this.runHandler(this.handler, toMessageEvent(fact, raw)).catch((err: unknown) => {
      process.stderr.write(`[${LABEL}] handler threw: ${messageOf(err)}\n`);
    });
  }

  /**
   * Accept each invite once. The `/v3` invite list is the current set and is sent again with every
   * change: a ship that left it is forgotten, and a ship is remembered only once its rsvp succeeded,
   * so a failed one is tried again with the next list.
   */
  private acceptInvites(ships: readonly string[]): void {
    this.accepted = new Set(ships.filter((ship) => this.accepted.has(ship)));
    for (const ship of ships) {
      if (ship === this.ship || this.accepted.has(ship)) continue;
      this.client
        .poke("chat", "chat-dm-rsvp", rsvpPoke(ship))
        .then((result) => {
          if (result.ok) this.accepted.add(ship);
          else
            process.stderr.write(
              `[${LABEL}] DM invite from ${ship} not accepted: ${result.message}\n`,
            );
        })
        .catch((err: unknown) => {
          process.stderr.write(
            `[${LABEL}] DM invite from ${ship} not accepted: ${messageOf(err)}\n`,
          );
        });
    }
  }

  private onStopped(err: Error): void {
    this.connected = false;
    process.stderr.write(`[${LABEL}] stopped: ${err.name}: ${err.message}\n`);
  }
}

function toMessageEvent(
  fact: Extract<ChatFact, { kind: "essay" }>,
  raw: unknown,
): GatewayMessageEvent {
  const sender = fact.author === "" ? normalizeShip(fact.whom) : fact.author;
  return {
    id: fact.id,
    platform: "tlon_urbit",
    sender: { id: sender },
    channel: { id: fact.whom, type: "dm" },
    text: fact.text,
    receivedAt: Date.now(),
    tlon_urbit: { ship: sender, messageId: fact.id, sent: fact.sent, raw },
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
