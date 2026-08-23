/**
 * `WhatsAppCloudBackend` — Meta WhatsApp Business Cloud API backend (ADR D304).
 *
 * `connect()` verifies the credential against Meta and caches the result; `disconnect()` clears
 * it. This header used to say both were no-ops, which is what the code did and what the first
 * live run of the WhatsApp suite refuted (#58): a wrong or revoked token reported success at
 * startup and surfaced as messages that silently never arrived.
 *
 * There is still no session to open — HTTP push via webhook is the only inbound channel, and
 * outbound is a stateless POST. What `connect()` buys is the startup answer to "can this
 * credential act as this number?", which is the question every sibling adapter answers and this
 * one did not. Outbound delegates to `WhatsAppCloudClient`. Inbound dispatch is driven by the
 * user calling `handleWebhookPayload(rawBody, sig)` from inside their HTTP route.
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
import { WhatsAppCloudClient } from "./client.js";
import type { MetaTemplateComponent } from "./types.js";
import {
  normalizeInboundMessages,
  normalizeStatusReceipts,
  parseWebhookPayload,
  verifyWebhookSignature,
} from "./webhook.js";

export interface WhatsAppCloudBackendOptions {
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly appSecret: string;
  readonly apiVersion?: string;
  /** Test seam. */
  readonly fetch?: typeof fetch;
}

/**
 * WhatsApp backend over Meta's official Cloud API.
 *
 * The supported path: Meta dials in with webhook deliveries, so inbound needs a publicly reachable
 * HTTPS endpoint registered in the Meta console. Outbound is a plain HTTPS call and works anywhere.
 * Business-initiated messages outside the 24-hour customer service window must use an approved
 * template — a plain text send to a cold contact is rejected by the platform, not by this code.
 */
export class WhatsAppCloudBackend implements WhatsAppBackend {
  readonly kind = "cloud" as const;
  private readonly client: WhatsAppCloudClient;
  /** Verified once by `connect()`; cleared by `disconnect()`. */
  private connected = false;
  /**
   * The verification currently in flight, shared by every caller that arrives during it.
   *
   * A flag alone only guards callers that arrive AFTER one finished — two simultaneous
   * `connect()` calls would each ask Meta, which is one wasted round-trip at startup and a
   * rate-limit source under a supervisor that health-checks on a schedule. Cleared when it
   * settles, so a failed attempt does not become a permanent refusal: a transient blip must stay
   * distinguishable from a revoked token.
   */
  private connecting?: Promise<boolean>;
  /**
   * Which connection attempt is current.
   *
   * Bumped by every `connect()` and every `disconnect()`. Without it a verify that was still in
   * flight when `disconnect()` ran would set `connected` back to true as it resolved, and every
   * later `connect()` would short-circuit on a flag no live check stands behind — the field's own
   * comment claims `disconnect()` clears it, and it did not. Same guard the Baileys backend
   * carries, for the same reason.
   */
  private generation = 0;
  private readonly appSecret: string;
  private inboundHandler?: (event: WhatsAppInboundEvent) => Promise<void>;
  private statusHandler?: (receipt: WhatsAppStatusReceipt) => Promise<void>;

  constructor(opts: WhatsAppCloudBackendOptions) {
    this.client = new WhatsAppCloudClient({
      accessToken: opts.accessToken,
      phoneNumberId: opts.phoneNumberId,
      apiVersion: opts.apiVersion,
      ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
    });
    this.appSecret = opts.appSecret;
  }

  // Cloud has no persistent connection — webhook is push, send is HTTP.
  /**
   * Confirm with Meta that this credential can act as this phone number.
   *
   * This used to be `return true`. A consumer with a wrong, expired or revoked token got success
   * at startup and found out from messages that silently never arrived — no error, no log,
   * nothing to alert on, which is the worst failure mode a gateway has. The first live run of the
   * WhatsApp suite caught it (#58); no unit test could, because a fake backend always accepts.
   *
   * Idempotent, like every sibling: verified once, then cached. Re-asking on every call would
   * turn a supervisor's health check into a rate-limit source against Meta.
   *
   * Returns false rather than throwing — the contract each sibling adapter is tested against,
   * because a throw at startup takes the whole runner down with it. The reason goes to stderr
   * first: told only "false", a supervisor cannot tell a revoked token, which needs a human,
   * from a rate limit, which needs a wait.
   */
  async connect(): Promise<boolean> {
    if (this.connected) return true;
    if (this.connecting !== undefined) return this.connecting;

    const attempt = this.verifyOnce(++this.generation);
    this.connecting = attempt;
    try {
      return await attempt;
    } finally {
      // Only clear what is still ours: `disconnect()` clears it too, and a later `connect()` may
      // already have installed its own.
      if (this.connecting === attempt) this.connecting = undefined;
    }
  }

  /** One credential check, mapped to the boolean `connect()` is contracted to return. @internal */
  private async verifyOnce(generation: number): Promise<boolean> {
    const check = await this.client.verifyCredentials();
    if (!check.ok) {
      process.stderr.write(
        `[whatsapp-cloud] connect failed: ${check.error?.code ?? "unknown"} — ` +
          `${check.error?.message ?? "no reason given"}\n`,
      );
      return false;
    }
    // A `disconnect()` that arrived while this was in flight wins: adopting now would leave a
    // flag standing over a backend the caller has already closed.
    if (this.generation !== generation) return false;
    this.connected = true;
    return true;
  }

  async disconnect(): Promise<void> {
    this.generation += 1;
    this.connected = false;
    this.connecting = undefined;
    this.inboundHandler = undefined;
    this.statusHandler = undefined;
  }

  async send(message: WhatsAppOutboundMessage): Promise<WhatsAppSendResult> {
    return this.client.sendText(message.to, message.text, message.isGroup);
  }

  /**
   * Send an approved template to `to`.
   *
   * Cloud-only, and deliberately absent from the `WhatsAppBackend` interface: WhatsApp Web has no
   * concept of templates, so putting this on the shared contract would hand the web backend a
   * method it could only throw from. A consumer reaches it by holding the backend directly.
   *
   * This is the only way to message someone outside the 24-hour service window — every
   * notification, and every unattended check that this integration still works. Free-form text to
   * a cold recipient comes back as `session_window_expired`.
   *
   * @param templateName Name of a template already approved on the WhatsApp Business account.
   * @param languageCode Locale of the approved template, e.g. `en_US`, `pt_BR`.
   * @param components Values for the template's variables; omit for a template that takes none.
   */
  async sendTemplate(
    to: string,
    templateName: string,
    languageCode: string,
    components?: ReadonlyArray<MetaTemplateComponent>,
  ): Promise<WhatsAppSendResult> {
    return this.client.sendTemplate(to, templateName, languageCode, components);
  }

  onInbound(handler: (event: WhatsAppInboundEvent) => Promise<void>): () => void {
    this.inboundHandler = handler;
    return () => {
      // Identity-guarded: a stale unsubscribe must be a no-op. Without it,
      // `onInbound(A)` → `onInbound(B)` → `A.off()` clears B's handler and the backend goes
      // silent with no error — nothing to see in a log, nothing to alert on. This is a public
      // export implementing an exported interface, so a consumer holding the backend directly
      // reaches it without going through `WhatsAppAdapter`.
      if (this.inboundHandler === handler) this.inboundHandler = undefined;
    };
  }

  onStatusReceipt(handler: (receipt: WhatsAppStatusReceipt) => Promise<void>): () => void {
    this.statusHandler = handler;
    return () => {
      if (this.statusHandler === handler) this.statusHandler = undefined;
    };
  }

  /**
   * Webhook entrypoint. The user calls this from inside their POST /webhook
   * route after `verifyWebhookSubscription` on GET.
   *
   * @returns `true` if signature valid + dispatched (or empty payload).
   *          `false` if signature invalid (route should return 401).
   */
  async handleWebhookPayload(
    rawBody: Buffer | string,
    signatureHeader: string | undefined,
  ): Promise<boolean> {
    if (!verifyWebhookSignature(rawBody, signatureHeader, this.appSecret)) {
      return false;
    }
    const json = this.parseBody(rawBody);
    if (json === undefined) return false;
    const envelope = parseWebhookPayload(json);
    if (envelope === null) return true; // valid signature, unrecognized shape — nothing to dispatch
    for (const event of normalizeInboundMessages(envelope)) {
      if (this.inboundHandler === undefined) continue;
      await this.dispatchContained(() => this.inboundHandler?.(event), "handler");
    }
    for (const receipt of normalizeStatusReceipts(envelope)) {
      if (this.statusHandler === undefined) continue;
      await this.dispatchContained(() => this.statusHandler?.(receipt), "status handler");
    }
    return true;
  }

  /**
   * Parse a signed webhook body, or report `undefined` when it is not JSON.
   *
   * The method's contract is true/false; the route calling it has no reason to expect a throw.
   */
  private parseBody(rawBody: Buffer | string): unknown | undefined {
    try {
      return JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"));
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[whatsapp-cloud] webhook body is not JSON: ${m}\n`);
      return undefined;
    }
  }

  /**
   * Run one user callback and contain its failure.
   *
   * Meta batches several messages, and their delivery receipts, into a single webhook. Awaiting a
   * handler with nothing around it made one throw skip every remaining message in the payload —
   * and reject `handleWebhookPayload`, so the caller's route answered 500 and Meta redelivered the
   * whole batch, replaying the messages that HAD succeeded (#41).
   */
  private async dispatchContained(
    run: () => Promise<void> | undefined,
    what: string,
  ): Promise<void> {
    try {
      await run();
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[whatsapp-cloud] ${what} threw: ${m}\n`);
    }
  }
}
