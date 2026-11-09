/**
 * Options and wire shapes of `ZaloAdapter`.
 *
 * @public
 */

/** A `fetch`-shaped function; the adapter's only network seam. @public */
export type ZaloFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

/** Credentials and seams for `ZaloAdapter`. @public */
export interface ZaloAdapterOptions {
  /** The Zalo app id (sent as `app_id` in every webhook; part of the signed string). */
  readonly appId: string;
  /**
   * The Zalo OA secret key; signs each webhook and is used only to verify it.
   *
   * @platform-term OA secret key (Zalo Official Account)
   * @issued-at the Zalo developers console, your app, Official Account, Webhook settings
   */
  readonly oaSecretKey: string;
  /**
   * A Zalo Official Account access token, sent as the `access_token` header on every Open API
   * call. It expires; supply a fresh one (this adapter does not refresh it).
   *
   * @platform-term OA access token (Zalo Official Account)
   * @issued-at the Zalo developers console, your app, Official Account, access token tool
   */
  readonly accessToken: string;
  /** Override the Open API base, `https://openapi.zalo.me`. */
  readonly apiBase?: string;
  /** Test seam; defaults to global `fetch`. */
  readonly fetch?: ZaloFetch;
}

/** One webhook event of the Zalo OA callback. @public */
export interface ZaloWebhookEvent {
  readonly app_id?: string;
  readonly event_name?: string;
  readonly sender?: { readonly id?: string };
  readonly recipient?: { readonly id?: string };
  readonly message?: { readonly text?: string; readonly msg_id?: string };
  readonly timestamp?: string | number;
}
