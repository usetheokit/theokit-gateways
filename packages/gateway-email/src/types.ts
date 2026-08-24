/**
 * Public option types for `@theokit/gateway-email` (ADRs D327-D339).
 *
 * @public
 */

/**
 * Sentinel runtime export — workaround for rollup-plugin-dts deep type-only
 * re-export bug. The marker is INTENTIONALLY orphan: it forces rollup-plugin-dts
 * to keep the module in the bundle so re-exports from `index.ts` resolve.
 *
 * @knipignore
 */
export const __emailTypesMarker: unique symbol = Symbol("email-types");

/** Adapter options. */
export interface EmailAdapterOptions {
  /** Email address the bot listens on (also the From: of outbound). */
  readonly address: string;
  /**
   * The mailbox password, or an app-specific password where the provider requires one.
   *
   * @platform-term IMAP and SMTP both call this a **password**. Note the divergence: `nodemailer`
   * names its field `pass`, and this one is `password` — ours, not theirs.
   * @issued-at The mail provider's account settings; most require an app password rather than the
   * login password when two-factor authentication is on.
   */
  readonly password: string;
  /** IMAP server (e.g., "imap.gmail.com"). */
  readonly imapHost: string;
  /** IMAP port. Default 993 (SSL). */
  readonly imapPort?: number;
  /** SMTP server (e.g., "smtp.gmail.com"). */
  readonly smtpHost: string;
  /** SMTP port. Default 587 (STARTTLS). */
  readonly smtpPort?: number;
  /** Display name for outbound From: (defaults to address local-part). */
  readonly fromName?: string;
  /** Allowlist of sender addresses (case-insensitive). Default: open (D333). */
  readonly allowedSenders?: readonly string[];
  /** Allow automated senders (noreply, postmaster, bounce). Default: false (D332). */
  readonly allowAutomated?: boolean;
  /** Polling interval in ms when IMAP IDLE is unavailable. Default 15000. */
  readonly pollIntervalMs?: number;
  /** Max body chars before truncation (EC-2). Default 50000 (~12k tokens). */
  readonly maxBodyChars?: number;
  /** Test seam — inject fake IMAP client. @internal */
  readonly __imapFactory?: (cfg: unknown) => unknown;
  /** Test seam — inject fake SMTP client. @internal */
  readonly __smtpFactory?: (cfg: unknown) => unknown;
}
