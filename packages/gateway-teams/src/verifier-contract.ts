/**
 * What `teamsActivityVerifier` takes and answers: its options, its result, and the default message
 * of every refusal reason. The types reach consumers through the package root.
 */

/**
 * The three cloud endpoints the SDK validator reads. The SDK's own `CloudEnvironment` values
 * (`PUBLIC`, `US_GOV`, `CHINA`, ...) are assignable to it, so a sovereign cloud is passed as is.
 *
 * @public
 */
export interface TeamsCloudEndpoints {
  /** The Entra login endpoint, e.g. `https://login.microsoftonline.com`. */
  readonly loginEndpoint: string;
  /** The Bot Framework token issuer, e.g. `https://api.botframework.com`. */
  readonly tokenIssuer: string;
  /**
   * The OpenID metadata URL; the SDK and the verifier derive the Bot Framework key-set URL from it
   * by replacing its trailing `/openidconfiguration` with `/keys`, so it must end in that suffix.
   */
  readonly openIdMetadataUrl: string;
}

/**
 * Options for {@link teamsActivityVerifier}.
 *
 * @public
 */
export interface TeamsActivityVerifierOptions {
  /** The bot's Microsoft app id: the audience every accepted token must carry. */
  readonly clientId: string;
  /**
   * Restrict accepted tokens to this tenant. A token whose `tid` differs is `tenant_mismatch`, and
   * one with no `tid` is `tenant_unverified`. Microsoft documents no `tid` on Bot Framework
   * connector tokens, so with this set every such activity may be refused; omit it on that path.
   * `common`, `organizations` and `consumers` name no tenant and are refused at construction.
   */
  readonly tenantId?: string;
  /** The cloud to validate against. Defaults to the SDK's public cloud. */
  readonly cloud?: TeamsCloudEndpoints;
  /** Test seam: a module standing in for the SDK's middleware module. @internal */
  readonly __validatorModule?: unknown;
}

/**
 * What the verifier answers. On success it returns the parsed activity and the token's app id and
 * service URL; on refusal, one typed `reason` and a `message` that never contains the token.
 *
 * @public
 */
export type TeamsActivityVerifyResult =
  | {
      readonly ok: true;
      readonly activity: Readonly<Record<string, unknown>>;
      readonly token: { readonly appId: string; readonly serviceUrl: string };
    }
  | {
      readonly ok: false;
      readonly reason:
        | "missing_authorization"
        | "malformed_body"
        | "body_already_read"
        | "validator_unavailable"
        | "invalid_token"
        | "key_set_unavailable"
        | "audience_mismatch"
        | "serviceurl_mismatch"
        | "channel_mismatch"
        | "tenant_mismatch"
        | "tenant_unverified";
      readonly message: string;
    };

export type Refusal = Extract<TeamsActivityVerifyResult, { ok: false }>;
export type RefusalReason = Refusal["reason"];

const MESSAGES: Readonly<Record<RefusalReason, string>> = {
  missing_authorization: "no Authorization header: the request carries no Bot Framework token",
  malformed_body:
    "the request body is over 1 MiB or is not a readable JSON activity with a non-empty string serviceUrl",
  body_already_read:
    "the request body was already read or is locked by another reader, so the verifier could not read the activity: this is the route's fault, not the sender's; pass the verifier an unread request, for example request.clone()",
  validator_unavailable: "the Teams SDK token validator could not be loaded",
  invalid_token:
    "the Teams SDK did not accept the token (bad signature, unknown key, wrong audience or issuer, expired, or a serviceurl it compared and found different)",
  key_set_unavailable:
    "the published signing keys could not be read, so the token's signature could not be checked; a retry may succeed",
  audience_mismatch: "the token's aud claim is not this bot's app id",
  serviceurl_mismatch:
    "the token's serviceurl claim is absent or differs from the activity's serviceUrl",
  channel_mismatch:
    "the activity's channelId is absent or is not msteams: the token is the bot's, but the activity did not come from Teams",
  tenant_mismatch: "the token's tid claim names a tenant other than the configured one",
  tenant_unverified:
    "the token's tenant cannot be confirmed: no tid with a tenant configured, or a tenant-issued token with none configured",
};

export function refuse(reason: RefusalReason, message: string = MESSAGES[reason]): Refusal {
  return { ok: false, reason, message };
}
