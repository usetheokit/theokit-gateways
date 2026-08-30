/**
 * Backend abstraction (ADR D303). Lets `WhatsAppAdapter` stay backend-agnostic
 * while we ship both Cloud (Meta API) and Web (`whatsapp-web.js` subprocess)
 * implementations side by side.
 *
 * @internal
 */

/**
 * Sentinel runtime export — prevents rollup-plugin-dts from treating this
 * file as a pure-types module (workaround for a bundler quirk with deeply
 * re-exported types). Not used at runtime.
 *
 * @knipignore
 */
export const __backendTypesMarker: unique symbol = Symbol("backend-types");

/** Normalized inbound event — cloud + web both produce this shape. */
export interface WhatsAppInboundEvent {
  /** Stable message id (`wamid.xxx` cloud, `msg.id._serialized` web). */
  readonly wamid: string;
  /** Sender phone (digits only — no `+` prefix). */
  readonly fromPhone: string;
  /** Cloud-only Meta phone-number-id; undefined for web. */
  readonly phoneNumberId?: string;
  /** Display name when available. */
  readonly contactName?: string;
  /** Conversation type. */
  readonly conversationType: "dm" | "group";
  /** Channel id — either the sender phone (DM) or the group id (group). */
  readonly channelId: string;
  /** Plain-text body (already filtered by EC-4 — text-only in v1). */
  readonly text: string;
  /** Receipt timestamp (ms since epoch). */
  readonly receivedAt: number;
  /**
   * The account owner wrote this to themselves — a note-to-self, not a message from a stranger.
   *
   * Absent means "somebody else", never "not checked": only the path that deliberately admits a
   * `fromMe` message inside the self-chat sets it. A consumer applying a sender policy should read
   * this BEFORE an allowlist, because the sender identity cannot carry the answer — the self-chat
   * reports the account's LID, and no user can be expected to look up their own LID to allowlist
   * themselves.
   */
  readonly fromSelf?: boolean;
  /** Backend that emitted this event. */
  readonly backend: "cloud" | "web" | "baileys";
  /** Raw envelope for the escape hatch. */
  readonly raw: unknown;
}

/** Outbound message — what `WhatsAppBackend.send` accepts. */
export interface WhatsAppOutboundMessage {
  /** Phone (digits, E.164 minus `+`) or group id. */
  readonly to: string;
  /** Whether `to` is a group id (cloud needs different shape; web is implicit). */
  readonly isGroup: boolean;
  /** Plain-text body (already split for 4096-char cap). */
  readonly text: string;
}

/** Status receipt (ADR D307). */
export interface WhatsAppStatusReceipt {
  /** The `wamid` we previously sent. */
  readonly wamid: string;
  /** Delivery lifecycle stage. */
  readonly status: "sent" | "delivered" | "read" | "failed";
  /** Recipient (digits-only phone). */
  readonly recipient: string;
  /** Receipt timestamp. */
  readonly timestamp: number;
}

/**
 * What went wrong, in the vocabulary a caller can branch on.
 *
 * Extracted from `WhatsAppSendResult` rather than copied beside it: a credential check and a
 * send fail for the same reasons, and two declarations of one vocabulary drift the moment
 * somebody adds a code to one of them.
 */
export interface WhatsAppError {
  readonly code:
    | "auth_failed"
    | "rate_limit"
    | "invalid_request"
    /**
     * More than 24 hours since the recipient last replied. The payload was
     * fine and the credential is fine; WhatsApp policy refuses free-form text
     * outside that window. The remedy is specific and different from every
     * other error here — resend as an approved template — which is why it is
     * its own code rather than one more `invalid_request`.
     */
    | "session_window_expired"
    /**
     * The recipient was never registered against this phone number. The payload
     * is fine and the credential is fine; the number simply may not message this
     * person yet. Its own code because the remedy is a console step rather than
     * anything in the request — and because every Cloud API app starts on a test
     * number, it is the error most integrations meet first.
     */
    | "recipient_not_allowlisted"
    /**
     * `send()` was called without a successful `connect()`, or after `disconnect()`.
     *
     * Its own code because all three backends reach this state and used to describe it three
     * different ways — `server_error` from web and Baileys, nothing at all from Cloud, which
     * sent regardless. A caller cannot branch on prose, and a conformance test cannot assert on
     * it either: one code is what makes "the implementations agree" a checkable claim rather
     * than a hope.
     */
    | "not_connected"
    /**
     * The recipient cannot receive this message, and no retry changes that:
     * no WhatsApp account, terms not accepted, an outdated client, or the
     * business having blocked them. Terminal by nature; the cause is in the
     * message.
     */
    | "undeliverable"
    | "server_error"
    | "timeout"
    | "unknown";
  readonly message: string;
}

/** Per-message send result returned by `WhatsAppBackend.send`. */
export interface WhatsAppSendResult {
  readonly ok: boolean;
  /** Set when ok=true. The wamid Meta / web assigned to the outbound message. */
  readonly wamid?: string;
  readonly error?: WhatsAppError;
}

/**
 * Whether a credential can act as the phone number it claims.
 *
 * Deliberately not a boolean. `connect()` collapses it to one because its contract says so, but
 * it prints the reason first — and a supervisor told only "false" cannot tell a revoked token,
 * which needs a human, from a rate limit, which needs a wait.
 */
export interface WhatsAppCredentialCheck {
  readonly ok: boolean;
  readonly error?: WhatsAppError;
}

/**
 * Backend contract — every backend (cloud, web, future) implements this shape.
 * `WhatsAppAdapter` delegates lifecycle + send + subscribe through this seam.
 */
export interface WhatsAppBackend {
  readonly kind: "cloud" | "web" | "baileys";
  /**
   * Make the backend usable, and report whether it is.
   *
   * Idempotent: a second call while connected returns `true` without repeating the work.
   *
   * **Operational failure returns `false`; misconfiguration throws.** A rejected credential, an
   * unreachable server, a session that never opens — those are conditions a supervisor can retry
   * or report, so they come back as `false` with the reason written where a human can read it. A
   * missing peer dependency or an absent browser is not: no retry fixes it, and answering `false`
   * would bury a setup error under a runtime one.
   *
   * The line was drawn after the conformance suite asserted the absolute version and two of three
   * implementations "failed" it — correctly. They throw `ConfigurationError` and
   * `WhatsAppBridgeError` for exactly the case that should not be swallowed.
   */
  connect(): Promise<boolean>;
  /** Release whatever `connect()` took. Idempotent, and safe on a backend that never connected. */
  disconnect(): Promise<void>;
  /**
   * Send one message.
   *
   * **Requires a successful `connect()` first, and refuses without one** — with
   * `ok: false, error.code === "not_connected"`, never a throw, and without touching the
   * transport. One code across every implementation, because a caller branches on the code and
   * a conformance test can only assert on one.
   *
   * That sentence is here because its absence cost something. The interface used to declare bare
   * signatures, each implementation answered the unasked question its own way, and they diverged:
   * web and Baileys refused, Cloud posted regardless. A consumer swapping backends — the single
   * thing this seam exists to allow — found unconnected sends leaving the process, which for
   * Cloud meant a real request carrying a credential nothing had verified, or one `connect()`
   * had already rejected.
   *
   * Enforced by `tests/backend-conformance.test.ts` against every implementation at once. A
   * per-backend test proves one of them does something; only a shared one proves they agree, and
   * the agreement is the product.
   */
  send(message: WhatsAppOutboundMessage): Promise<WhatsAppSendResult>;
  /** Subscribe to normalized inbound events. Returns unsubscribe. */
  onInbound(handler: (event: WhatsAppInboundEvent) => Promise<void>): () => void;
  /** Subscribe to status receipts. Returns unsubscribe. */
  onStatusReceipt(handler: (receipt: WhatsAppStatusReceipt) => Promise<void>): () => void;
}
