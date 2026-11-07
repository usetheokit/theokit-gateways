/**
 * The LINE half of a framework channel webhook, in the shape `theokit/server/webhook` validators
 * take: `(request) => Promise<{ ok: true } | { ok: false; reason }>`. The shape is structural, so
 * this package imports nothing from the framework.
 *
 * ```ts
 * await handleChannelWebhook(request, pathname, {
 *   validators: { line: lineWebhookVerifier(adapter) },
 * })
 * ```
 *
 * @public
 */

import { verifyLineSignature } from "./signature.js";

/** What a verifier answers. @public */
export type LineWebhookVerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Build a verifier for one channel secret (or an adapter exposing `getChannelSecret()`).
 *
 * The request body is READ as raw text, because LINE signs the exact bytes; pass a clone if the
 * body is needed afterwards.
 *
 * @public
 */
export function lineWebhookVerifier(
  source: string | { getChannelSecret(): string },
): (request: Request) => Promise<LineWebhookVerifyResult> {
  return async (request: Request): Promise<LineWebhookVerifyResult> => {
    const rawBody = await request.text();
    const signature = request.headers.get("x-line-signature") ?? undefined;
    if (signature === undefined) return { ok: false, reason: "missing x-line-signature header" };
    const secret = typeof source === "string" ? source : source.getChannelSecret();
    return verifyLineSignature(secret, rawBody, signature)
      ? { ok: true }
      : { ok: false, reason: "signature mismatch" };
  };
}
