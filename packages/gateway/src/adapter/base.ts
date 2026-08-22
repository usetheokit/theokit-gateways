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
 * Lifecycle defaults (`startTyping`, `stopTyping`) noop unless overridden.
 *
 * **Contract:**
 * - `connect()` is idempotent. Calling twice returns true the second time.
 * - `disconnect()` is idempotent.
 * - `sendMessage` returns a `SendResult`; it MUST NOT throw on platform errors
 *   (rate-limit, 4xx, network). Programmer errors (missing config) MAY throw.
 * - `onInbound(handler)` returns an unsubscribe function. EC-H: calling
 *   `onInbound` twice replaces the previous handler — does NOT stack.
 * - `sendMessage` with empty text returns `{ ok: false, code: "empty_text" }`.
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

  /** Lifecycle: emit a typing indicator. Default: noop. */
  async startTyping(_channelId: string): Promise<void> {
    /* override */
  }

  /** Lifecycle: stop the typing indicator. Default: noop. */
  async stopTyping(_channelId: string): Promise<void> {
    /* override */
  }
}
