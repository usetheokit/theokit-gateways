/**
 * `SMSAdapter` — implements `BasePlatformAdapter` over a backend
 * (twilio / plivo / vonage). ADRs D389-D396.
 *
 * Lifecycle:
 * - `connect()` initializes the chosen backend (lazy peer-dep import).
 * - `disconnect()` releases the backend; idempotent.
 * - `sendMessage()` splits multipart (D393) and sends each part via backend.
 * - `onInbound(handler)` replaces previous handler (EC-H, mirror D276).
 *
 * Inbound dispatch is driven by the webhook server (`webhook-server.ts`)
 * which calls `adapter.dispatchInbound(ctx)` after signature verification.
 *
 * @public
 */

import {
  BasePlatformAdapter,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
} from "@theokit/gateway";
import { createBackend } from "./backend/index.js";
import type { SignatureContext, SMSBackend } from "./backend-types.js";
import { ConfigurationError } from "./errors.js";
import { inboundToMessageEvent } from "./normalize.js";
import { normalizeE164 } from "./phone.js";
import { splitForSMS } from "./split.js";
import type { SMSAdapterOptions } from "./types.js";

export class SMSAdapter extends BasePlatformAdapter {
  /**
   * Whether the "this medium carries no formatting" warning has already been emitted.
   *
   * Once per adapter, not once per message: a gateway answering a busy channel would turn a
   * useful diagnostic into a log flood, and a flooded log is one nobody reads — the same
   * reason the group-mention and allowlist drops elsewhere in this family log once.
   */
  private warnedAboutFormat = false;

  /**
   * Say, once, that a declared format is being dropped.
   *
   * `OutboundMessage.format` is the caller stating intent, and this medium has nowhere to put
   * it: no flag, no markup, no alternative part. Discarding it in silence is the swallowed-
   * error shape `rules/error-handling.md` refuses — nothing fails, and the caller learns their
   * formatting never arrived from a user, weeks later.
   *
   * @internal
   */
  private warnFormatUnsupported(format: string | undefined): void {
    // The "is there anything to say" question lives here rather than at the call site: a
    // `sendMessage` already at its complexity limit should ask one thing, not three.
    if (format === undefined || format === "plain") return;
    if (this.warnedAboutFormat) return;
    this.warnedAboutFormat = true;
    process.stderr.write(
      `[gateway-sms] format="${format}" was declared, and SMS cannot carry it — ` +
        "the medium is plain text. Sending unformatted; this is logged once.\n",
    );
  }

  readonly platform = "sms" as const;

  /**
   * The URL the provider POSTs inbound to, as the provider sees it.
   *
   * Required by all three backend option shapes and documented there as "used by signature
   * verifier" — and, measured 2026-08-31, read by nothing: it appeared only in the type and in test
   * fixtures. Twilio SIGNS this URL, so the value matters most in exactly the case where the
   * request cannot supply it: behind a proxy or a tunnel, the request's own URL is the internal one
   * and will not match what was signed.
   *
   * Exposed so {@link smsWebhookVerifier} can use it, which is what makes the option true.
   */
  readonly publicUrl: string;

  private readonly backend: SMSBackend;
  private inboundHandler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private connected = false;
  private readonly defaultCountry: string | undefined;

  constructor(opts: SMSAdapterOptions) {
    super();
    // EC-1: refuse to operate without signing secret.
    const secret = secretFromOpts(opts);
    if (secret.length === 0) {
      throw new ConfigurationError({
        code: "signing_secret_required",
        message: `gateway-sms: backend="${opts.backend}" requires a signing secret (would accept unsigned webhooks)`,
      });
    }
    this.defaultCountry = opts.defaultCountry;
    this.publicUrl = opts.publicUrl;
    this.backend = createBackend(opts);
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    const ok = await this.backend.connect();
    this.connected = ok;
    return ok;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.backend.disconnect();
    this.connected = false;
    this.inboundHandler = undefined;
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "outbound text is empty" } };
    }
    let toE164: string;
    try {
      toE164 = normalizeE164(out.channel.id, this.defaultCountry);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { code: "invalid_phone_number", message: msg } };
    }
    const parts = splitForSMS(out.text);
    // Send sequentially so the recipient sees them in order; concurrent
    // submit would still cost the same but breaks ordering at carriers.
    let lastResult: SendResult | undefined;
    // SMS is plain text by definition. Reading the field is not ceremony: it is what turns a
    // silent discard into a stated one.
    this.warnFormatUnsupported(out.format);

    for (const part of parts) {
      lastResult = await this.backend.sendMessage(toE164, part);
      if (lastResult.ok !== true) {
        return {
          ok: false,
          error: {
            code: lastResult.error?.code ?? "partial_send_failure",
            message: `partial send failed after ${parts.indexOf(part)}/${parts.length}: ${lastResult.error?.message ?? "unknown"}`,
          },
        };
      }
    }
    return lastResult ?? { ok: false, error: { code: "send_failed", message: "no parts sent" } };
  }

  onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    // EC-H: replace, not stack.
    this.inboundHandler = handler;
    return () => {
      if (this.inboundHandler === handler) this.inboundHandler = undefined;
    };
  }

  /**
   * Webhook hook — called by `createWebhookServer` AFTER signature
   * verification + parseInbound. Returns dispatch outcome (used for
   * 200/204 vs 500 by the webhook handler).
   *
   * @internal
   */
  async dispatchInbound(ctx: SignatureContext): Promise<"ok" | "no_handler" | "parse_failed"> {
    if (!this.backend.verifySignature(ctx)) {
      // Caller (webhook-server) inspects this via verifySignature directly,
      // but we re-check defensively if anyone calls dispatch directly.
      return "parse_failed";
    }
    let inbound: ReturnType<SMSBackend["parseInbound"]>;
    try {
      inbound = this.backend.parseInbound(ctx);
    } catch {
      return "parse_failed";
    }
    if (this.inboundHandler === undefined) return "no_handler";
    const event = inboundToMessageEvent(inbound, this.backend.kind);
    try {
      await this.inboundHandler(event);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[gateway-sms] handler threw: ${msg}\n`);
    }
    return "ok";
  }

  /**
   * Direct signature check — used by the webhook server to respond
   * `401` BEFORE dispatch when signature is invalid.
   *
   * @internal
   */
  verifySignature(ctx: SignatureContext): boolean {
    return this.backend.verifySignature(ctx);
  }

  /**
   * Direct parse — used by the webhook server when signature was already
   * validated upstream. Returns the normalized `SMSMessageEvent` to be
   * dispatched.
   *
   * @internal
   */
  buildEventFromCtx(ctx: SignatureContext): GatewayMessageEvent {
    const inbound = this.backend.parseInbound(ctx);
    return inboundToMessageEvent(inbound, this.backend.kind);
  }

  /**
   * Dispatch a pre-built event (used by webhook server after manual
   * signature + parse). Honors EC-H replace semantics and isolates
   * handler exceptions per `gateway-runner` contract.
   *
   * @internal
   */
  async dispatchEvent(event: GatewayMessageEvent): Promise<"ok" | "no_handler"> {
    if (this.inboundHandler === undefined) return "no_handler";
    try {
      await this.inboundHandler(event);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[gateway-sms] handler threw: ${msg}\n`);
    }
    return "ok";
  }

  /** Backend kind (escape hatch for callers needing to introspect). */
  getBackendKind(): "twilio" | "plivo" | "vonage" {
    return this.backend.kind;
  }

  /**
   * Deliver an event that arrived out of band — the ingest `onInbound` had no counterpart for (#83).
   *
   * One line over `runHandler`, which owns the containment: a handler is user code, its throw is
   * named as the handler's failure rather than the platform's, and delivery continues.
   */
  override async deliver(
    event: GatewayMessageEvent,
  ): Promise<"ok" | "no_handler" | "handler_threw"> {
    return this.runHandler(this.inboundHandler, event);
  }
}

function secretFromOpts(opts: SMSAdapterOptions): string {
  switch (opts.backend) {
    case "twilio":
      return opts.authToken;
    case "plivo":
      return opts.authToken;
    case "vonage":
      return opts.signatureSecret;
    default: {
      const _exhaustive: never = opts;
      void _exhaustive;
      return "";
    }
  }
}
