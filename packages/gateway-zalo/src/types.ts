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

/** @public */
export interface ZaloAdapterOptions {
  /** The Zalo app id (sent as `app_id` in every webhook; part of the signed string). */
  readonly appId: string;
  /** The OA secret key from the app's webhook settings; signs each webhook. */
  readonly oaSecretKey: string;
  /** A valid OA access token. It expires; supply a fresh one (this adapter does not refresh it). */
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
