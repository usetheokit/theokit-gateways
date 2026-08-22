/**
 * Public option types for `SMSAdapter`.
 *
 * Constructor accepts a discriminated union (`backend` field) so the
 * shape of credentials matches the chosen provider. Common fields
 * (`fromNumber`, `publicUrl`, `defaultCountry`, `requireMention`-style
 * options) are absent — SMS has no notion of mention/threads.
 *
 * @public
 */

export interface TwilioOptions {
  readonly backend: "twilio";
  readonly accountSid: string;
  /** Auth token used for signature verification — REQUIRED (D392, EC-1). */
  readonly authToken: string;
  /** Bot's own E.164 number (used as `from` in outbound). */
  readonly fromNumber: string;
  /** Public URL where Twilio posts inbound — used by signature verifier. */
  readonly publicUrl: string;
  /** Default country for unprefixed inbound `from` numbers. Optional. */
  readonly defaultCountry?: string;
}

/** Construction options for the Plivo backend. */
export interface PlivoOptions {
  readonly backend: "plivo";
  readonly authId: string;
  /** Auth token used for V3 signature verification — REQUIRED (D392, EC-1). */
  readonly authToken: string;
  readonly fromNumber: string;
  readonly publicUrl: string;
  readonly defaultCountry?: string;
}

/** Construction options for the Vonage backend. */
export interface VonageOptions {
  readonly backend: "vonage";
  readonly apiKey: string;
  readonly apiSecret: string;
  /** Signature secret (a.k.a. Signature Secret in Vonage dashboard) — REQUIRED (D392, EC-1). */
  readonly signatureSecret: string;
  readonly fromNumber: string;
  readonly publicUrl: string;
  readonly defaultCountry?: string;
}

/**
 * Construction options for the SMS adapter — one variant per supported provider.
 *
 * Discriminated by `backend`, so choosing a provider narrows the object to exactly the credentials
 * that provider needs; a Twilio account SID cannot be passed to Vonage by accident.
 */
export type SMSAdapterOptions = TwilioOptions | PlivoOptions | VonageOptions;
