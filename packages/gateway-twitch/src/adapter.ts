/**
 * `TwitchAdapter` — `BasePlatformAdapter` over Twitch chat: `channel.chat.message` notifications
 * from an EventSub WebSocket, replies through Helix Send Chat Message.
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

import { type EventSubMetadata, EventSubSession } from "./eventsub.js";
import { HelixClient } from "./helix.js";
import { SeenIds } from "./seen-ids.js";
import { splitForTwitch } from "./split.js";
import type { FetchLike, TwitchAdapterOptions, TwitchSocket } from "./types.js";

const LABEL = "gateway-twitch";
const EVENTSUB_URL = "wss://eventsub.wss.twitch.tv/ws";
const CONNECT_TIMEOUT_MS = 10_000;
const SEND_TIMEOUT_MS = 30_000;
const REQUIRED_SCOPES = ["user:read:chat", "user:write:chat"] as const;
const USER_ID = /^\d+$/;

interface ChatEvent {
  readonly broadcaster_user_id?: unknown;
  readonly chatter_user_id?: unknown;
  readonly chatter_user_login?: unknown;
  readonly message_id?: unknown;
  readonly message?: { readonly text?: unknown };
}

const defaultSocketFactory = (url: string): TwitchSocket =>
  new WebSocket(url) as unknown as TwitchSocket;

/**
 * Twitch chat adapter for one bot account in one or more channels.
 *
 * `connect()` validates the token (it must be the bot's, with `user:read:chat` and
 * `user:write:chat`), opens the EventSub socket and subscribes to `channel.chat.message` for every
 * broadcaster; it answers `true` once every subscription is accepted and `false`, never a throw,
 * otherwise or after 10000 ms. A notification becomes one `TwitchMessageEvent` (repeats, by
 * `message_id`, are dropped), except the bot's own messages. A reply longer than 500 characters goes
 * as several messages, in order.
 *
 * @public
 */
export class TwitchAdapter extends BasePlatformAdapter {
  readonly platform = "twitch" as const;
  private readonly opts: TwitchAdapterOptions;
  private readonly helix: HelixClient;
  private readonly session: EventSubSession;
  private readonly seen = new SeenIds();
  private handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private connected = false;
  private connecting: Promise<boolean> | undefined;
  private welcomed: ((sessionId: string) => void) | undefined;
  /** Bumped by `disconnect()`, so a connect it overtook does not report connected. */
  private generation = 0;
  private warnedAboutHtml = false;

  /** @throws Error when `broadcasterUserIds` is empty or an id is not numeric */
  constructor(opts: TwitchAdapterOptions) {
    super();
    if (
      opts.broadcasterUserIds.length === 0 ||
      !opts.broadcasterUserIds.every((id) => USER_ID.test(id))
    ) {
      throw new Error(`${LABEL}: broadcasterUserIds must hold at least one numeric user id`);
    }
    this.opts = opts;
    const fetchFn: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
    this.helix = new HelixClient(opts.accessToken, fetchFn);
    this.session = new EventSubSession({
      url: opts.eventSubUrl ?? EVENTSUB_URL,
      socketFactory: opts.socketFactory ?? defaultSocketFactory,
      onWelcome: (sessionId, kind) => this.onWelcome(sessionId, kind),
      onNotification: (metadata, payload) => this.onNotification(metadata, payload),
      onRevocation: (subscription) => logRevocation(subscription),
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
    this.welcomed = undefined;
    this.session.close();
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "outbound text is empty" } };
    }
    if (!this.connected) {
      return {
        ok: false,
        error: { code: "not_connected", message: "TwitchAdapter.connect() has not succeeded" },
      };
    }
    if (!USER_ID.test(out.channel.id)) {
      return {
        ok: false,
        error: {
          code: "invalid_channel",
          message: `channel.id must be the broadcaster's numeric user id, got ${JSON.stringify(out.channel.id)}`,
        },
      };
    }
    const parts = splitForTwitch(this.textFor(out));
    const answer = await withTimeout(SEND_TIMEOUT_MS, (signal) =>
      this.sendParts(out, parts, signal),
    );
    if (answer === "timeout") {
      return {
        ok: false,
        error: { code: "timeout", message: `Twitch did not answer within ${SEND_TIMEOUT_MS} ms` },
      };
    }
    return answer;
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

  /** Send the parts in order; the first refusal stops the rest. The last part's id is the answer. */
  private async sendParts(
    out: OutboundMessage,
    parts: readonly string[],
    signal: AbortSignal,
  ): Promise<SendResult> {
    let messageId = "";
    for (const [index, text] of parts.entries()) {
      const sent = await this.helix.sendChat(
        {
          broadcasterId: out.channel.id,
          senderId: this.opts.botUserId,
          text,
          ...(index === 0 && out.replyTo !== undefined ? { replyTo: out.replyTo } : {}),
        },
        signal,
      );
      if (!sent.ok) return { ok: false, error: { code: sent.code, message: sent.message } };
      messageId = sent.messageId;
    }
    return { ok: true, messageId };
  }

  /** The text to send: markdown loses its markers, html goes as is with one warning. */
  private textFor(out: OutboundMessage): string {
    if (out.format === "markdown") return channelRendering(this.platform).translate(out.text);
    if (out.format === "html" && !this.warnedAboutHtml) {
      this.warnedAboutHtml = true;
      process.stderr.write(
        `[${LABEL}] format="html" was declared and Twitch chat is plain text; sending the text unchanged. Logged once.\n`,
      );
    }
    return out.text;
  }

  private async openSession(): Promise<boolean> {
    const generation = this.generation;
    const ok = await withTimeout(CONNECT_TIMEOUT_MS, (signal) =>
      this.establish(signal, generation),
    ).catch((err: unknown) => {
      process.stderr.write(`[${LABEL}] connect failed: ${messageOf(err)}\n`);
      return false as const;
    });
    if (ok === true && generation === this.generation) {
      this.connected = true;
      return true;
    }
    if (ok === "timeout")
      process.stderr.write(
        `[${LABEL}] connect failed: no answer within ${CONNECT_TIMEOUT_MS} ms\n`,
      );
    this.welcomed = undefined;
    if (generation === this.generation) this.session.close();
    return false;
  }

  /** Validate the token, open the socket, wait for the welcome and subscribe every channel. */
  private async establish(signal: AbortSignal, generation: number): Promise<boolean> {
    const check = await this.helix.validate(signal);
    // Overtaken by disconnect(): open no socket for a session nobody wants.
    if (generation !== this.generation) return false;
    if (!check.ok) return refuse(check.reason);
    if (check.userId !== this.opts.botUserId) {
      return refuse(
        `the token belongs to user ${check.userId}, not to botUserId ${this.opts.botUserId}`,
      );
    }
    const missing = REQUIRED_SCOPES.filter((scope) => !check.scopes.includes(scope));
    if (missing.length > 0) return refuse(`the token lacks ${missing.join(" and ")}`);
    const welcome = new Promise<string>((resolve) => {
      this.welcomed = resolve;
    });
    this.session.open();
    const sessionId = await welcome;
    if (generation !== this.generation) return false;
    return this.subscribeAll(sessionId, signal, "connect failed");
  }

  private async subscribeAll(
    sessionId: string,
    signal: AbortSignal,
    context: string,
  ): Promise<boolean> {
    const statuses = await Promise.all(
      this.opts.broadcasterUserIds.map((broadcaster) =>
        this.helix.subscribe(sessionId, broadcaster, this.opts.botUserId, signal),
      ),
    );
    const refused = statuses
      .map((status, i) => ({ status, broadcaster: this.opts.broadcasterUserIds[i] }))
      .filter(({ status }) => status !== 202);
    if (refused.length === 0) return true;
    return refuse(
      `channel.chat.message subscription refused: ${refused.map((r) => `${r.broadcaster} (HTTP ${r.status})`).join(", ")}`,
      context,
    );
  }

  /** A new session needs its subscriptions again; a handover keeps them. */
  private onWelcome(sessionId: string, kind: "new" | "handover"): void {
    const waiting = this.welcomed;
    if (waiting !== undefined) {
      this.welcomed = undefined;
      waiting(sessionId);
      return;
    }
    if (kind === "handover" || !this.connected) return;
    // A session that could not be subscribed delivers nothing: drop it, and the next one, dialled
    // with backoff, is subscribed again.
    withTimeout(CONNECT_TIMEOUT_MS, (signal) =>
      this.subscribeAll(sessionId, signal, "resubscribe failed"),
    )
      .then((ok) => {
        if (ok !== true) this.session.restart();
      })
      .catch((err: unknown) => {
        process.stderr.write(`[${LABEL}] resubscribe failed: ${messageOf(err)}\n`);
        this.session.restart();
      });
  }

  private onNotification(metadata: EventSubMetadata, payload: unknown): void {
    if (metadata.subscription_type !== "channel.chat.message") return;
    const id = metadata.message_id;
    if (typeof id !== "string" || !this.seen.add(id)) return;
    const event = toMessageEvent((payload as { event?: ChatEvent } | undefined)?.event);
    if (event === undefined || event.sender.id === this.opts.botUserId) return;
    void this.runHandler(this.handler, event).catch((err: unknown) => {
      process.stderr.write(`[${LABEL}] handler threw: ${messageOf(err)}\n`);
    });
  }
}

function toMessageEvent(chat: ChatEvent | undefined): GatewayMessageEvent | undefined {
  const broadcaster = chat?.broadcaster_user_id;
  const chatter = chat?.chatter_user_id;
  const messageId = chat?.message_id;
  if (
    typeof broadcaster !== "string" ||
    typeof chatter !== "string" ||
    typeof messageId !== "string"
  ) {
    return undefined;
  }
  const login = typeof chat?.chatter_user_login === "string" ? chat.chatter_user_login : "";
  const text = typeof chat?.message?.text === "string" ? chat.message.text : "";
  return {
    id: messageId,
    platform: "twitch",
    sender: { id: chatter, username: login },
    channel: { id: broadcaster, type: "group" },
    text,
    receivedAt: Date.now(),
    twitch: {
      broadcasterUserId: broadcaster,
      chatterUserId: chatter,
      chatterLogin: login,
      messageId,
      raw: chat,
    },
  };
}

/** One stderr line naming what was revoked, for which channel and why (EC-18). */
function logRevocation(subscription: unknown): void {
  const sub = (subscription ?? {}) as {
    type?: unknown;
    status?: unknown;
    condition?: { broadcaster_user_id?: unknown };
  };
  process.stderr.write(
    `[${LABEL}] subscription revoked: ${String(sub.type)} for broadcaster ${String(sub.condition?.broadcaster_user_id)} (${String(sub.status)})\n`,
  );
}

function refuse(reason: string, context = "connect failed"): false {
  process.stderr.write(`[${LABEL}] ${context}: ${reason}\n`);
  return false;
}

/** Run `work` with an abort signal; `"timeout"` once `ms` passes first, after aborting it. */
async function withTimeout<T>(
  ms: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T | "timeout"> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
