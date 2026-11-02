/**
 * Public option types for `@theokit/gateway-teams` (ADRs D315-D326).
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
export const __teamsTypesMarker: unique symbol = Symbol("teams-types");

/** Adapter options. */
export interface TeamsAdapterOptions {
  /** Azure AD application client id. */
  readonly clientId: string;
  /**
   * The Teams app registration's client secret.
   *
   * @platform-term Microsoft calls this a **client secret** — OAuth's own word, and the field
   * `@microsoft/teams.apps` uses, so the name here is theirs.
   * @issued-at The Azure portal, under the app registration's Certificates & secrets.
   */
  readonly clientSecret: string;
  /** Azure AD tenant id. */
  readonly tenantId: string;
  /** Optional bot display name used as a fallback for mention stripping. */
  readonly botDisplayName?: string;
  /**
   * Deliver a groupChat or channel message only when it mentions the bot. Default `true`.
   *
   * A mention is a `mention` entity on the activity whose `mentioned.id` is the activity's
   * `recipient.id`. An activity with no `recipient.id` is dropped (one stderr line says why). A
   * personal conversation is always delivered. Pass `false` to deliver every message, as the
   * adapter did before this option existed.
   */
  readonly requireMention?: boolean;
  /**
   * Pluggable HTTP server adapter — typically `new ExpressAdapter(yourExpressApp)`
   * from `@microsoft/teams.apps`. When provided, the SDK registers
   * `POST /api/messages` on your existing server (ADR D316/D326).
   */
  readonly httpServerAdapter?: unknown;
  /** Test seam — inject a fake credential check, so no test needs a real tenant. @internal */
  readonly __tokenFetcher?: (opts: {
    clientId: string;
    clientSecret: string;
    tenantId: string;
  }) => Promise<{ ok: boolean; status: number; error?: string }>;
  /** Test seam — inject a fake App instance. @internal */
  readonly __appFactory?: (opts: {
    clientId: string;
    clientSecret: string;
    tenantId: string;
    httpServerAdapter?: unknown;
  }) => unknown;
}
