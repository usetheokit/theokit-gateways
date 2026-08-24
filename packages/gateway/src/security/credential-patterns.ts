/**
 * This domain's credential shapes, masked before anything reaches a log.
 *
 * `Security.redact` ships patterns aimed at AI and cloud provider keys — OpenAI, Anthropic, GitHub,
 * AWS, Slack, Stripe and others. Measured against the credentials these packages hold, it altered
 * exactly one: Slack's `xoxb-`, because that is one of its built-ins. On a Telegram token it was
 * worse than absent: a token is `<bot_id>:<secret>`, the numeric prefix is the bot's PUBLIC user id,
 * and the SDK's `key=value` matcher stops at the colon — so `token=8123456789:AAF…` came out as
 * `token=***:AAF…`, the public half removed and the secret half preserved.
 *
 * **Why this masks rather than registering with `Security.addPattern`.** The first attempt did
 * register, and a review measured two defects in it.
 *
 * The SDK applies extra patterns BEFORE its own `key=value` rule and masks a match as
 * `first6…last4`. Claiming a value there therefore DOWNGRADED it: `password=<passphrase>` had been
 * `password=***` and became `password=hunter…aple` — ten characters of an operator's mail password
 * reaching stderr where none did before, under a changelog entry announcing that redaction was
 * fixed. A security change that reduces security is the worst shape a fix can take.
 *
 * And `addPattern` mutates module state inside the SDK. Any app importing this package would
 * inherit these shapes in its own unrelated redaction — after the first gateway error, not before,
 * so the same process would redact differently either side of one exception.
 *
 * Masking here, fully, before the text is handed over, avoids both: the value is gone rather than
 * shortened, and nothing outside this module changes behaviour.
 *
 * **What is deliberately NOT covered** is in {@link CREDENTIAL_SHAPES}.uncovered. Some credentials
 * have no format that can be told apart from an ordinary identifier, and a pattern wide enough to
 * catch them eats the dashless UUIDs and ULIDs a developer reads a log to find. Losing a
 * correlation id costs a debugging session; the gap is recorded instead.
 *
 * @module
 */
import { Security } from "@theokit/sdk";

/** A credential shape this module masks, and the cost of matching it. */
export interface CoveredShape {
  /** The platform and field, for the reader of the table. */
  readonly field: string;
  /** Anchored to the shape. */
  readonly pattern: RegExp;
  /** What else this matches. Every entry has one — a shape narrow enough to have none is rare. */
  readonly alsoMatches: string;
}

/** A credential this repository declares and this module does not mask. */
export interface UncoveredShape {
  /** The platform and field. */
  readonly field: string;
  /** Why a pattern for it would cost more than it buys. */
  readonly why: string;
}

/**
 * What is masked and what is not.
 *
 * The uncovered list is the point of publishing this as data rather than burying it in a regex
 * table: a reader can see which of their credentials this protects, and a maintainer adding an
 * adapter can see the standard the new shape has to meet.
 */
export const CREDENTIAL_SHAPES: {
  readonly covered: readonly CoveredShape[];
  readonly uncovered: readonly UncoveredShape[];
} = {
  covered: [
    {
      field: "gateway-telegram `token`",
      pattern: /(?<![A-Za-z0-9])\d{8,10}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g,
      alsoMatches:
        "an 8-10 digit number joined by a colon to exactly 35 url-safe characters — a timestamped identifier of that exact width would be masked",
    },
    {
      field: "gateway-discord `token`",
      pattern:
        /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}(?![A-Za-z0-9_-])/g,
      alsoMatches: "a three-part dotted identifier of those widths; a JWT's middle part is longer",
    },
    {
      field: "gateway-slack `appToken`",
      pattern: /(?<![A-Za-z0-9-])xapp-\d-[A-Z0-9]+-\d+-[a-f0-9]{32,}(?![a-f0-9])/g,
      alsoMatches: "nothing plausible — the `xapp-` prefix and the shape are Slack's",
    },
    {
      field: "gateway-matrix `accessToken`",
      pattern: /(?<![A-Za-z0-9_])syt_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+_[A-Za-z0-9]+(?![A-Za-z0-9_-])/g,
      alsoMatches: "nothing plausible — `syt_` is Matrix's own prefix",
    },
    {
      field: "gateway-whatsapp `accessToken`",
      pattern: /(?<![A-Za-z0-9])EAA[A-Za-z0-9]{20,}(?![A-Za-z0-9])/g,
      alsoMatches: "any identifier beginning EAA followed by 20 or more alphanumerics",
    },
    {
      field: "gateway-teams `clientSecret`",
      pattern:
        /(?<![A-Za-z0-9~])[A-Za-z0-9]{3}\d[A-Za-z0-9]?~[A-Za-z0-9._~-]{30,}(?![A-Za-z0-9._~-])/g,
      alsoMatches: "an Entra-style secret is the only common value with a tilde in that position",
    },
  ],
  uncovered: [
    {
      field: "gateway-sms `authToken` (Twilio), gateway-line `channelSecret`",
      why: "32 lowercase hex characters, which is also an md5 digest, a dashless UUID and half a git tree hash. Masking it would eat the correlation id a developer reads the log to find.",
    },
    {
      field: "gateway-mattermost `accessToken`",
      why: "26 lowercase alphanumerics, which is exactly a lowercase ULID — the shape of most trace ids.",
    },
    {
      field: "gateway-email `password`, gateway-sms `apiSecret` and `signatureSecret` (Vonage)",
      why: "no format of their own; a passphrase is indistinguishable from prose. The SDK's own `key=value` rule already masks these fully wherever they appear as `field=value`, and adding a pattern here made that WORSE by claiming the value first — it was masked as first6…last4 instead of removed.",
    },
    {
      field: "gateway-slack `botToken`",
      why: "already masked by one of the SDK's own twelve built-in patterns — `xoxb-` is Slack's and the SDK knows it. A pattern here would be a second one doing the first's work, and the field-level gate flagged its absence, which is the gate working.",
    },
    {
      field: "gateway-whatsapp `appSecret`",
      why: "32 lowercase hex, the same shape as the Twilio auth token above and as every md5 and dashless UUID. Masking it would eat the correlation ids in a log.",
    },
    {
      field: "gateway-line `channelAccessToken`, gateway-sms `authToken` (Plivo)",
      why: "long base64 runs with no prefix, indistinguishable from any encoded blob a platform library puts in an error message.",
    },
  ],
};

/**
 * Replace every covered shape with `***`.
 *
 * Full replacement rather than the SDK's `first6…last4`: a partial mask of a credential is still a
 * disclosure, and the six leading characters of a token identify the account it belongs to.
 *
 * @param text
 * @returns the text with covered shapes removed
 */
export function maskShapes(text: string): string {
  let out = text;
  for (const { pattern } of CREDENTIAL_SHAPES.covered) out = out.replace(pattern, "***");
  return out;
}

/**
 * Mask this domain's shapes, then apply the SDK's redactor.
 *
 * The one function the log sites call. Order matters: ours runs first so a covered shape is gone
 * before the SDK's `key=value` rule can shorten it instead, and the SDK still contributes its own
 * twelve patterns for everything we do not know about.
 *
 * @param value the value to redact — a message, an error, anything stringifiable
 * @returns the redacted string
 */
export function redactSecrets(value: unknown): string {
  return Security.redact(maskShapes(typeof value === "string" ? value : String(value)));
}
