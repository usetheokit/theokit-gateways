/**
 * `BasePlatformAdapter` — contract every transport adapter implements
 * (T1.2, ADR D172).
 *
 * Adapters share ~30% of lifecycle code (typing indicators, event
 * normalization patterns). An abstract class with concrete defaults
 * + abstract hooks is the right shape — interface-only would force
 * every adapter to copy the defaults.
 *
 * Consumers use it via `instanceof` and the public subclass exports
 * (`TelegramAdapter`, `DiscordAdapter`, ...).
 */

import type { MessageEvent as GatewayMessageEvent, PlatformName } from "../types/message-event.js";

/** Outbound message shape — what `sendMessage` accepts. */
export interface OutboundMessage {
  readonly channel: {
    readonly id: string;
    readonly type: "dm" | "group" | "thread";
    readonly topicId?: string;
  };
  readonly text: string;
  /** Markdown / HTML rendering hint. Default "plain". */
  readonly format?: "plain" | "markdown" | "html";
  /** Optional reply target. */
  readonly replyTo?: string;
}

/** Send result — adapters return this instead of throwing on platform errors. */
export interface SendResult {
  readonly ok: boolean;
  readonly messageId?: string;
  readonly error?: { readonly code: string; readonly message: string };
}

/**
 * Abstract base for all platform adapters.
 *
 * Subclasses implement `connect`, `disconnect`, `sendMessage`, `onInbound`.
 * Lifecycle defaults (`startTyping`, `stopTyping`) noop unless overridden; `editMessage` refuses
 * with `edit_unsupported` unless overridden.
 *
 * **Contract:**
 * - `connect()` is idempotent. Calling twice returns true the second time.
 * - `disconnect()` is idempotent.
 * - `sendMessage` returns a `SendResult`; it MUST NOT throw on platform errors
 *   (rate-limit, 4xx, network). Programmer errors (missing config) MAY throw.
 * - `onInbound(handler)` returns an unsubscribe function. EC-H: calling
 *   `onInbound` twice replaces the previous handler — does NOT stack.
 * - `sendMessage` with empty text returns `{ ok: false, code: "empty_text" }`.
 * - `supportsEdit` says whether the adapter has an edit call. It is `false` unless the adapter
 *   overrides it, and it MUST NOT change with `connect()`. `true` does not promise that every
 *   edit is accepted: an adapter whose injected client lacks the edit call (Matrix) still answers
 *   `edit_unsupported`, which a caller handles like any other refusal.
 * - `editMessage` returns a `SendResult` and never throws on platform errors. The default refuses
 *   with `edit_unsupported` and makes no platform call.
 * - Edits are not ordered by the adapter. Two edits of one message id in flight at once reach the
 *   platform in either order, so a caller awaits each edit before the next, or keeps one in flight
 *   and coalesces to the latest text.
 *
 * @public
 */
export abstract class BasePlatformAdapter {
  abstract readonly platform: PlatformName;

  /** Open the connection. Returns `true` on success; never throws. */
  abstract connect(): Promise<boolean>;

  /** Close the connection. Idempotent; safe to call when never connected. */
  abstract disconnect(): Promise<void>;

  /** Send a message. Returns a `SendResult`; never throws on platform errors. */
  abstract sendMessage(out: OutboundMessage): Promise<SendResult>;

  /**
   * Subscribe to inbound events. Returns an unsubscribe function.
   * EC-H: second call REPLACES the previous handler (does not stack).
   *
   * The handler is user code and may throw. An adapter MUST contain that throw, report it as the
   * HANDLER's failure — not the platform's — and keep delivering: one bad message never ends the
   * process nor the connection. Two adapters used to discard the rejection with `void`, which under
   * Node's default ends the process, and two more reported it as a platform-client error, sending
   * whoever debugged their own handler to the wrong repository. Eight had converged on the right
   * behaviour without anything writing it down; `tests/lint/adapter-contract.test.ts` now holds all
   * ten to it.
   */
  abstract onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void;

  /**
   * Deliver an inbound event that arrived OUT OF BAND, and report what the handler did with it.
   *
   * Six adapters self-deliver once connected — long polling, a gateway socket, Socket Mode, a sync
   * loop, IMAP. The webhook platforms cannot: the payload arrives on an HTTP route the application
   * owns, and until this existed there was no supported call that joined the two. `onInbound` had no
   * public counterpart, so `GatewayRunner` was reachable for eight platforms and not for LINE or
   * WhatsApp Cloud, which every app then wired by hand beside the runner instead of through it
   * (#83).
   *
   * The return value distinguishes the three outcomes a caller can act on, because they are not the
   * same problem: nobody subscribed, the handler ran, or the handler threw. Answering a webhook 200
   * for the first is wrong — the provider would stop retrying a message nothing received.
   *
   * Implementations should be one line over {@link runHandler}, which owns the containment.
   */
  abstract deliver(event: GatewayMessageEvent): Promise<"ok" | "no_handler" | "handler_threw">;

  /**
   * Run a subscribed handler and contain its failure. The body of {@link deliver}, written once.
   *
   * A handler is USER code and may throw. An adapter must contain that throw, name it as the
   * handler's failure rather than the platform's, and keep delivering — one bad message ends
   * neither the process nor the connection. Two adapters once discarded the rejection with `void`,
   * which under Node's default ends the process; two more reported it as a platform-client error,
   * sending whoever debugged their own handler to the wrong repository (#41).
   *
   * Ten copies of that knowledge is ten chances to get it wrong, so it lives here. The platform tag
   * is taken from `this.platform`, which is the only part that differed between them.
   */
  protected async runHandler(
    handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined,
    event: GatewayMessageEvent,
  ): Promise<"ok" | "no_handler" | "handler_threw"> {
    if (handler === undefined) return "no_handler";
    try {
      await handler(event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[${this.platform}] handler threw: ${message}\n`);
      return "handler_threw";
    }
    return "ok";
  }

  /**
   * Whether {@link editMessage} can replace the text of a message this adapter sent.
   *
   * Read it before starting a preview: on `false`, send the final text instead. An adapter sets
   * it at construction and MUST NOT change it with `connect()`. Annotated as `boolean` so that an
   * edit-capable adapter can override it with `true`.
   */
  readonly supportsEdit: boolean = false;

  /**
   * Replace the text of a message this adapter sent, keeping its id.
   *
   * Returns `{ ok: true, messageId }` on success and a `SendResult` error otherwise; it never
   * throws on platform errors. An edit-capable adapter applies, with no request, the same local
   * checks its `sendMessage` applies (such as `empty_text`, and `not_connected` where the send
   * checks the connection), plus `invalid_message_id`, and `edit_too_long` where the adapter
   * splits text: an edit that would need more than one platform message is refused, never split.
   *
   * Default: refuses with `edit_unsupported`, makes no platform call, and checks nothing else
   * first, so capability is answered before input.
   */
  async editMessage(_messageId: string, _out: OutboundMessage): Promise<SendResult> {
    return {
      ok: false,
      error: {
        code: "edit_unsupported",
        message: `${this.platform} adapter cannot edit a sent message`,
      },
    };
  }

  /** Lifecycle: emit a typing indicator. Default: noop. */
  async startTyping(_channelId: string): Promise<void> {
    /* override */
  }

  /** Lifecycle: stop the typing indicator. Default: noop. */
  async stopTyping(_channelId: string): Promise<void> {
    /* override */
  }
}
