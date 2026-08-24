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
  /**
   * The SMS provider's auth token, used both to call the API and to verify inbound signatures.
   *
   * @platform-term Twilio calls this an **auth token**. The name is pinned on the verification
   * surface — `RequestValidatorOptions.authToken` in the `twilio` package — which is the call this
   * adapter makes. On the CLIENT surface the same SDK names it `password`, so "theirs" is true of
   * the half we use and not of the other. Plivo names its field `authToken`; Vonage's equivalent
   * is an API secret.
   * @issued-at The Twilio Console dashboard, beside the Account SID.
   */
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
  /**
   * The Vonage API secret for this SMS account.
   *
   * @platform-term Vonage calls this an **API secret**, and `@vonage/auth` names the field
   * `apiSecret`, so the name here is theirs.
   * @issued-at The Vonage API Dashboard, beside the API key.
   */
  readonly apiSecret: string;
  /**
   * The Vonage signature secret, used to verify inbound SMS webhooks.
   *
   * @platform-term Vonage calls this a **signature secret** — a different object from the API
   * secret above, and issued separately.
   * @issued-at The Vonage API Dashboard, under Settings → Inbound messages, once signed webhooks
   * are enabled.
   */
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
