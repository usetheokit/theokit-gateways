/**
 * The options `WhatsAppAdapter` is built from: one config per backend and the options they share.
 *
 * Moved out of `adapter.ts` unchanged (B-674), so that file stays within its 500-line budget.
 * `adapter.ts` re-exports every type here, so no import of them changes.
 */

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
   * authenticates outbound calls, which is why it may be empty: an adapter that only sends does
   * not need it. Verifying a webhook needs it: `verifyWebhookSignature` throws
   * `ConfigurationError` for an empty or whitespace-only secret, because anyone can compute an
   * HMAC under an empty key.
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
