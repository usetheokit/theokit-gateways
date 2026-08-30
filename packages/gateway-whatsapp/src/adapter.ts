/**
 * `WhatsAppAdapter` — WhatsApp platform adapter for `@theokit/gateway`
 * (Adoption Roadmap v1.4 #2; ADRs D303-D314).
 *
 * Multi-backend (Cloud + Web) — backend chosen via `WhatsAppAdapterOptions.backend`.
 * Backend-agnostic adapter delegates lifecycle + send + subscribe through the
 * `WhatsAppBackend` seam (D303).
 *
 * @public
 */

import {
  BasePlatformAdapter,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
  type WhatsAppMessageEvent,
} from "@theokit/gateway";

import { isSenderAllowed, parseAllowedSenders } from "./allowlist.js";
import { WhatsAppBaileysBackend } from "./backend/baileys/index.js";
import { WhatsAppCloudBackend } from "./backend/cloud/index.js";
import { WhatsAppWebBackend } from "./backend/web/index.js";
import type {
  WhatsAppBackend,
  WhatsAppInboundEvent,
  WhatsAppStatusReceipt,
} from "./backend-types.js";
import { ConfigurationError } from "./errors.js";
import { splitForWhatsApp } from "./split.js";

/** Cloud (Meta WhatsApp Business Cloud API) backend config (ADR D304). */
export interface WhatsAppCloudConfig {
  /**
   * The Meta system user's access token for the WhatsApp Business account.
   *
   * @platform-term Meta calls this an **access token**. Unlike the other adapters' terms, this one
   * is NOT pinned to a package under `node_modules` — the Cloud backend calls the Graph API with
   * `fetch`, so there is no Meta SDK in the dependency graph to check against. It rests on Meta's
   * own documentation, and our client sends it as `authorization: Bearer …`, never as an
   * `access_token` parameter.
   * @issued-at Meta Business Manager, under System Users → Generate token, scoped to the WhatsApp
   * Business account.
   */
  readonly accessToken: string;
  /** Meta-issued phone-number-id (NOT the user-facing phone). */
  readonly phoneNumberId: string;
  /**
   * The Meta app secret, used to verify `X-Hub-Signature-256` on inbound WhatsApp webhooks.
   *
   * @platform-term Meta calls this an **app secret** — note it belongs to the Meta app, not to the
   * WhatsApp Business account, which is why it is issued somewhere different from the access token
   * above. It signs inbound payloads and never
   * authenticates outbound calls, which is why it is optional: an adapter that only sends does
   * not need it.
   * @issued-at Meta for Developers, under the app's Settings → Basic.
   */
  readonly appSecret: string;
  /** Graph API version. Defaults to `v18.0`. */
  readonly apiVersion?: string;
}

/**
 * Baileys backend config (ADR D319-D322).
 *
 * Unofficial, like the `web` backend: it automates a WhatsApp Web session, which Meta's terms
 * do not sanction and which can get a number banned. Unlike `web` it needs no browser.
 *
 * @public
 */
export interface WhatsAppBaileysConfig {
  /**
   * Directory holding the multi-file auth state — the pairing, persisted.
   *
   * Treat it like a credential: it IS the session, and anyone holding it is the account.
   */
  readonly sessionDir: string;
  /** Give up on `connect()` after this long. Default 60s. */
  readonly connectTimeoutMs?: number;
  /** Give up on one send after this long. Default 30s. */
  readonly sendTimeoutMs?: number;
  /**
   * Where the pairing QR goes, as often as WhatsApp reissues it. Defaults to stderr.
   *
   * The backend has always accepted this; it was reachable only by constructing the backend by
   * hand, which is the path this class exists to replace. A host that is not a terminal — a
   * service, a container, a web app — cannot read stderr back to the person holding the phone,
   * and without a route out the QR a fresh `sessionDir` can only ever time out.
   */
  readonly onQr?: (qr: string) => void;
}

/** Web (whatsapp-web.js subprocess bridge) backend config (ADR D305). */
export interface WhatsAppWebConfig {
  /** Stable session id used to lock the bridge per-workspace. */
  readonly sessionId: string;
  /** Optional override of the bridge script path (defaults to packaged bridge). */
  readonly bridgeScriptPath?: string;
}

/**
 * Which backend to build, and its configuration.
 *
 * The union carries only what DIFFERS between backends. Options that mean the same thing on
 * either one — `requireMention`, `botPhoneId`, `allowedSenders` — live in
 * {@link WhatsAppAdapterCommonOptions} instead, so there is one copy rather than one per arm
 * for the two copies to drift apart (ADR D318).
 *
 * @public
 */
export type WhatsAppAdapterOptions =
  | { readonly backend: "cloud"; readonly cloud: WhatsAppCloudConfig }
  | { readonly backend: "web"; readonly web: WhatsAppWebConfig }
  | { readonly backend: "baileys"; readonly baileys: WhatsAppBaileysConfig };

/**
 * Options that apply whichever backend is in use.
 *
 * @public
 */
export interface WhatsAppAdapterCommonOptions {
  /** D309: require an @mention in groups. Default `true`. */
  readonly requireMention?: boolean;
  /**
   * Phone id to detect mentions of (digits only).
   *
   * `fromCloud` defaults it to the phone number id. **The web backend has nothing to default
   * from**, so leaving it unset there while `requireMention` is on (its default) drops every
   * group message — the adapter cannot tell whether it was mentioned. That drop is now
   * logged rather than silent.
   */
  readonly botPhoneId?: string;
  /**
   * Comma-separated senders allowed to reach the handler. Absent leaves delivery unchanged;
   * an empty string admits nobody. See `allowlist.ts` for why those differ.
   */
  readonly allowedSenders?: string;
}

/**
 * Fail at the boundary when a required option is missing or blank.
 *
 * A factory that returns an adapter with an empty token has moved the error away from its
 * cause: the stack then names a send, and the mistake was in construction
 * (`rules/error-handling.md` § 2).
 */
function requireNonEmpty(entries: ReadonlyArray<readonly [string, string | undefined]>): void {
  for (const [name, value] of entries) {
    if (value === undefined || value.trim().length === 0) {
      throw new ConfigurationError({
        code: "missing_option",
        message: `gateway-whatsapp: ${name} is required and must not be empty.`,
      });
    }
  }
}

/** EC-7: digit-only normalizer for mention comparison (handles `+`, `-`, `()`, spaces). */
export function digitsOnly(s: string): string {
  return s.replace(/[^\d]/g, "");
}

/**
 * Characters that may appear INSIDE a written phone number: digits and the
 * separators people type around them. Anything else — a letter, a comma, a
 * newline — ends the run.
 */
const PHONE_RUN = /[\d][\d+\-().  ]*[\d]|[\d]/g;

/**
 * EC-7: the phone-like runs in a message, each normalized to digits.
 *
 * The filter used to normalize the WHOLE message and ask whether the result
 * contained the bot's number. That accepts the four documented formats, but it
 * also concatenates digits from unrelated words: with a bot at 5511999999999,
 * `"pedido 55 chegou 11, ref 99999-9999 ok"` normalized to a string containing
 * exactly that number, and the bot answered a message about an order. Every
 * group message carrying scattered digits woke it.
 *
 * Scanning runs instead keeps the separators irrelevant WITHIN a number — which
 * is what EC-7 asks for, and what `"+55 (11) 99999-9999"` needs — while letting
 * a letter or a comma do what it visually does: end the number.
 */
export function phoneRuns(s: string): string[] {
  return (s.match(PHONE_RUN) ?? []).map(digitsOnly).filter((d) => d.length > 0);
}

/**
 * Adapter facade. Implements `BasePlatformAdapter` (D172).
 *
 * Use `WhatsAppAdapter.fromCloud(config)` or `WhatsAppAdapter.fromWeb(config)`. The
 * constructor stays available for tests and for a backend of your own.
 */
export class WhatsAppAdapter extends BasePlatformAdapter {
  readonly platform = "whatsapp" as const;
  private readonly backendImpl: WhatsAppBackend;
  private readonly requireMention: boolean;
  private readonly botPhoneId: string;
  /** `undefined` = no allowlist configured; a set = configured, and enforced fail-closed. */
  private readonly allowedSenders: ReadonlySet<string> | undefined;
  /** Mirrors the sibling adapters: guards connect() against opening a second session. */
  private connected = false;
  private handler?: (event: GatewayMessageEvent) => Promise<void>;
  private statusHandler?: (receipt: WhatsAppStatusReceipt) => Promise<void>;
  // EC-H: track unsubscribe handles so onInbound REPLACES instead of stacks.
  private inboundUnsubscribe?: () => void;
  private statusUnsubscribe?: () => void;

  /**
   * Build an adapter from a discriminated configuration.
   *
   * The entry point for configuration that arrives as **data** — read from a file, an
   * environment, or a tenant record — where the backend is a string rather than a decision
   * made in code. `fromCloud` / `fromWeb` are the direct forms when the choice is already
   * known at the call site.
   *
   * This is what `WhatsAppAdapterOptions` exists for. Until it had this consumer the union
   * was exported, documented and inert, which is the defect #47 was filed about, and the
   * first attempt at closing that issue left it inert — the factories took the config halves
   * directly and never the union.
   *
   * @throws {ConfigurationError} when a required option is missing or empty.
   * @public
   */
  static from(
    options: WhatsAppAdapterOptions,
    common: WhatsAppAdapterCommonOptions = {},
  ): WhatsAppAdapter {
    switch (options.backend) {
      case "cloud":
        return WhatsAppAdapter.fromCloud(options.cloud, common);
      case "web":
        return WhatsAppAdapter.fromWeb(options.web, common);
      case "baileys":
        return WhatsAppAdapter.fromBaileys(options.baileys, common);
    }
  }

  /**
   * Build a Baileys adapter.
   *
   * Unofficial, and no amount of code changes that: it automates a WhatsApp Web session,
   * which Meta's terms do not sanction and which can get a number banned. Use a number
   * created for this, never a personal one. Prefer {@link WhatsAppAdapter.fromCloud} unless
   * the number has no Cloud API access.
   *
   * Unlike {@link WhatsAppAdapter.fromWeb} it embeds no browser — it speaks the multi-device
   * protocol over a WebSocket. `baileys` is an optional peer dependency; it is loaded lazily
   * at connect, so a consumer who never calls this never needs it installed.
   *
   * `botPhoneId` has nothing to default from here, so leaving it unset while `requireMention`
   * is on (its default) drops every group message. The adapter logs when it does.
   *
   * @throws {ConfigurationError} when `sessionDir` is missing or empty.
   * @public
   */
  static fromBaileys(
    baileys: WhatsAppBaileysConfig,
    opts: WhatsAppAdapterCommonOptions = {},
  ): WhatsAppAdapter {
    requireNonEmpty([["sessionDir", baileys.sessionDir]]);
    return new WhatsAppAdapter(
      new WhatsAppBaileysBackend({
        sessionDir: baileys.sessionDir,
        ...(baileys.connectTimeoutMs !== undefined
          ? { connectTimeoutMs: baileys.connectTimeoutMs }
          : {}),
        ...(baileys.sendTimeoutMs !== undefined ? { sendTimeoutMs: baileys.sendTimeoutMs } : {}),
        ...(baileys.onQr !== undefined ? { onQr: baileys.onQr } : {}),
      }),
      opts,
    );
  }

  /**
   * Build a Cloud-API adapter.
   *
   * The construction path this package's docblock has named since it was written, and which
   * did not exist until #47 — a consumer following the only guidance the package gave wrote
   * code that would not compile.
   *
   * Prefer it over the constructor: it keeps `WhatsAppCloudBackend` an implementation detail
   * of this package rather than something every consumer imports and assembles.
   *
   * @throws {ConfigurationError} when a required credential is missing or empty.
   * @public
   */
  static fromCloud(
    cloud: WhatsAppCloudConfig,
    opts: WhatsAppAdapterCommonOptions = {},
  ): WhatsAppAdapter {
    // `appSecret` is deliberately NOT required: it verifies inbound webhook signatures
    // (`backend/cloud/index.ts`) and outbound never reads it. This repository's own
    // integration suite passes `""` for exactly that reason, so requiring it would have
    // locked an outbound-only consumer out of the path this factory exists to offer.
    requireNonEmpty([
      ["accessToken", cloud.accessToken],
      ["phoneNumberId", cloud.phoneNumberId],
    ]);
    // INFO-10: an empty apiVersion yields `https://graph.facebook.com//<id>`, because the
    // client's `?? "v18.0"` does not catch `""`. Absent is fine; blank is a mistake.
    if (cloud.apiVersion !== undefined) {
      requireNonEmpty([["apiVersion", cloud.apiVersion]]);
    }
    return new WhatsAppAdapter(
      new WhatsAppCloudBackend({
        accessToken: cloud.accessToken,
        phoneNumberId: cloud.phoneNumberId,
        appSecret: cloud.appSecret,
        ...(cloud.apiVersion !== undefined ? { apiVersion: cloud.apiVersion } : {}),
      }),
      { ...opts, botPhoneId: opts.botPhoneId ?? cloud.phoneNumberId },
    );
  }

  /**
   * Build a WhatsApp-Web adapter.
   *
   * Unofficial: it drives a real WhatsApp Web session through a browser, which Meta's terms
   * do not sanction and which can get a number banned. It also needs a browser this package
   * does not install. Prefer {@link WhatsAppAdapter.fromCloud} unless the number has no
   * Cloud API access.
   *
   * @throws {ConfigurationError} when `sessionId` is missing or empty.
   * @public
   */
  static fromWeb(web: WhatsAppWebConfig, opts: WhatsAppAdapterCommonOptions = {}): WhatsAppAdapter {
    requireNonEmpty([["sessionId", web.sessionId]]);
    return new WhatsAppAdapter(
      new WhatsAppWebBackend({
        sessionId: web.sessionId,
        ...(web.bridgeScriptPath !== undefined ? { bridgeScriptPath: web.bridgeScriptPath } : {}),
      }),
      opts,
    );
  }

  /** Construct from a pre-built backend. Prefer the factories; this is for tests and for a custom backend. */
  constructor(backendImpl: WhatsAppBackend, opts: WhatsAppAdapterCommonOptions = {}) {
    super();
    this.backendImpl = backendImpl;
    this.requireMention = opts.requireMention ?? true;
    this.botPhoneId = digitsOnly(opts.botPhoneId ?? "");
    // Absent and empty are different answers. Absent means the operator has not adopted the
    // filter, and delivery is unchanged. Empty means they configured one and named nobody, which
    // is a decision — `parseAllowedSenders` is fail-closed and honours it.
    this.allowedSenders =
      opts.allowedSenders === undefined ? undefined : parseAllowedSenders(opts.allowedSenders);
  }

  /** Escape hatch (D180-style) for advanced features. */
  getBackend(): WhatsAppBackend {
    return this.backendImpl;
  }

  async connect(): Promise<boolean> {
    // Guard added 2026-08-17: this was the only adapter without one, so a second
    // connect() opened a second live WhatsApp session. Teams, SMS and Slack all
    // short-circuit here. Note it latches on SUCCESS only — a refused connect
    // must stay retryable, or one network blip becomes permanent.
    if (this.connected) return true;
    const ok = await this.backendImpl.connect();
    this.connected = ok;
    return ok;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.inboundUnsubscribe?.();
    this.inboundUnsubscribe = undefined;
    this.statusUnsubscribe?.();
    this.statusUnsubscribe = undefined;
    this.handler = undefined;
    this.statusHandler = undefined;
    await this.backendImpl.disconnect();
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "Empty text rejected." } };
    }
    // EC-8: split filters empty parts internally.
    const parts = splitForWhatsApp(out.text);
    if (parts.length === 0) {
      return {
        ok: false,
        error: { code: "empty_text", message: "Text reduced to zero parts after splitting." },
      };
    }
    let lastWamid: string | undefined;
    const isGroup = out.channel.type === "group";
    for (const part of parts) {
      const r = await this.backendImpl.send({ to: out.channel.id, isGroup, text: part });
      if (!r.ok) {
        return {
          ok: false,
          error: { code: r.error?.code ?? "unknown", message: r.error?.message ?? "Send failed." },
        };
      }
      lastWamid = r.wamid;
    }
    return lastWamid !== undefined ? { ok: true, messageId: lastWamid } : { ok: true };
  }

  /**
   * Is this sender refused by a configured allowlist?
   *
   * Runs before the group/mention filter because it answers a different question: that one asks
   * whether a message was meant for us, this one asks whether the sender may reach us at all.
   *
   * The refusal is logged. A silent drop is indistinguishable from a broken gateway, and the
   * first thing a mistyped allowlist causes is an operator wondering why the bot went mute.
   */
  private isRefusedBySenderAllowlist(inbound: WhatsAppInboundEvent): boolean {
    // The allowlist answers "may this STRANGER reach the agent?", and the account owner writing
    // in their own self-chat is not one. It also cannot answer it here: the self-chat reports the
    // account's LID as the sender, while an operator writes a phone number — measured on a real
    // paired session. Reading the flag rather than the address keeps the exemption tied to the
    // backend's own decision, so a stranger arriving on a LID is still refused.
    if (inbound.fromSelf === true) return false;
    if (this.allowedSenders === undefined) return false;
    if (isSenderAllowed(inbound.fromPhone, this.allowedSenders)) return false;
    process.stderr.write(
      `[whatsapp] dropped inbound from "${inbound.fromPhone}" — not in the configured allowlist\n`,
    );
    return true;
  }

  /** D309 + EC-7: group filter with digit-only normalization. */
  private shouldDropGroupMessage(inbound: WhatsAppInboundEvent): boolean {
    if (inbound.conversationType !== "group" || !this.requireMention) return false;
    if (this.botPhoneId.length === 0) {
      // Misconfigured: with no id to look for, every group message looks unaddressed. Saying
      // so matters more here than anywhere — the sibling allowlist check makes the same point
      // fifteen lines below, and a gateway that answers no group message and explains nothing
      // is indistinguishable from a broken one. Common with `fromWeb`, which has no phone
      // number id to default from.
      process.stderr.write(
        "[whatsapp] dropping every group message: requireMention is on and botPhoneId is unset\n",
      );
      return true;
    }
    return !phoneRuns(inbound.text).some((run) => run.includes(this.botPhoneId));
  }

  private toMessageEvent(inbound: WhatsAppInboundEvent): WhatsAppMessageEvent {
    return {
      id: inbound.wamid,
      platform: "whatsapp",
      sender: { id: inbound.fromPhone, displayName: inbound.contactName },
      channel: { id: inbound.channelId, type: inbound.conversationType },
      text: inbound.text,
      receivedAt: inbound.receivedAt,
      whatsapp: {
        wamid: inbound.wamid,
        phoneNumberId: inbound.phoneNumberId,
        contactName: inbound.contactName,
        backend: inbound.backend,
        raw: inbound.raw,
      },
    };
  }

  onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    // EC-H: replace any previous subscription.
    this.inboundUnsubscribe?.();
    this.handler = handler;

    const off = this.backendImpl.onInbound(async (inbound) => {
      if (!this.handler) return;
      if (this.isRefusedBySenderAllowlist(inbound)) return;
      if (this.shouldDropGroupMessage(inbound)) return;
      await this.handler(this.toMessageEvent(inbound));
    });
    this.inboundUnsubscribe = off;

    return () => {
      // Identity-guarded, like every sibling adapter. Without the guard this closure tore down
      // whatever subscription was CURRENT: `onInbound(A)` → `onInbound(B)` → A's stale `off()`
      // killed B's and nulled the handler, and the gateway went silent with no error. That is
      // the defect the cross-adapter contract exists to catch, and this adapter was exempted
      // from it by a comment claiming its mechanism gave "the same guarantee" — it had no
      // guard at all.
      if (this.handler === handler) {
        this.handler = undefined;
        off();
        this.inboundUnsubscribe = undefined;
      }
    };
  }

  /** Status receipts (sent/delivered/read/failed). Adapter-specific (D307). */
  onStatusReceipt(handler: (receipt: WhatsAppStatusReceipt) => Promise<void>): () => void {
    this.statusUnsubscribe?.();
    this.statusHandler = handler;
    const off = this.backendImpl.onStatusReceipt(async (r) => {
      await this.statusHandler?.(r);
    });
    this.statusUnsubscribe = off;
    return () => {
      // Same identity guard, same reason. A stale unsubscribe must be a no-op.
      if (this.statusHandler === handler) {
        this.statusHandler = undefined;
        off();
        this.statusUnsubscribe = undefined;
      }
    };
  }
}
