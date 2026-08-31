/**
 * The SMS half of a channel webhook, in the shape a framework webhook seam expects.
 *
 * `theokit/server/webhook` ships validators for the platforms whose signature is a plain HMAC it
 * can compute itself. SMS is not one of them: Twilio signs the URL plus the sorted POST parameters,
 * Plivo signs a different string again, and Vonage uses a JWT. Those three schemes already exist in
 * this package, correctly, with their own tests — reimplementing them one repository over would put
 * security-critical code in two places and guarantee they drift.
 *
 * So the direction is inverted. The framework declares the SHAPE; the package that owns the
 * platform provides the implementation. The shape is structural, so nothing here imports the
 * framework and this package gains no dependency:
 *
 * ```ts
 * await handleChannelWebhook(request, pathname, {
 *   validators: { sms: smsWebhookVerifier(adapter) },
 * })
 * ```
 *
 * @public
 */

import type { SMSAdapter } from "./adapter.js";
import type { SignatureContext } from "./backend-types.js";

/**
 * What a verifier answers. Structurally identical to the framework's `VerifyResult`, declared here
 * so this package does not depend on the framework to describe its own return value.
 *
 * @public
 */
export type WebhookVerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** Options for {@link smsWebhookVerifier}. @public */
export interface SMSWebhookVerifierOptions {
  /**
   * The URL the provider POSTs to, as the provider sees it.
   *
   * Twilio signs the URL, so verification compares against whatever string is passed here — and
   * behind a proxy or a tunnel the request's own URL is the INTERNAL one, which will not match.
   * Defaults to the adapter's configured `publicUrl` when it has one, and to the request URL
   * otherwise.
   */
  readonly publicUrl?: string;
}

/**
 * The subset of the adapter this verifier reads. Stated as an interface so the parameter is honest
 * about its requirements, and so a test can supply the two members without a live provider SDK.
 */
interface VerifiableAdapter {
  verifySignature(ctx: SignatureContext): boolean;
  readonly publicUrl?: string;
}

/**
 * The lowercased header map {@link SignatureContext} promises its consumers.
 *
 * No `toLowerCase()` here, and that is the point rather than an omission: the Fetch `Headers` object
 * normalises names on the way in, so iterating it already yields `x-twilio-signature` however the
 * sender wrote it. Lowercasing again was in the first version and mutation testing showed it dead —
 * removing it changed no test, because the platform had already done the work.
 */
function headersOf(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * Build a verifier for one configured SMS adapter.
 *
 * The request is READ, so pass a clone if the body is needed afterwards — a framework seam that
 * hands validators a `clone()` already does this. Reading it raw is not optional: every provider
 * signs the exact bytes, and a body that was parsed and re-serialised hashes differently.
 *
 * **Connect the adapter first.** Each backend loads its provider SDK during `connect()`, and until
 * it has, `verifySignature` answers `false` for everything — so a verifier wired before connect
 * refuses every genuine delivery as a bad signature. The two are NOT distinguishable here: the
 * backend contract returns a boolean, and inventing a reason this function cannot actually observe
 * would be worse than the ambiguity. The behaviour is pinned by a test rather than papered over,
 * and telling them apart needs a readiness signal the adapter does not expose today.
 *
 * @public
 */
export function smsWebhookVerifier(
  adapter: SMSAdapter | VerifiableAdapter,
  opts: SMSWebhookVerifierOptions = {},
): (request: Request) => Promise<WebhookVerifyResult> {
  return async (request: Request): Promise<WebhookVerifyResult> => {
    const rawBody = await request.text();
    const ctx: SignatureContext = {
      headers: headersOf(request),
      rawBody,
      url: opts.publicUrl ?? adapter.publicUrl ?? request.url,
    };
    return adapter.verifySignature(ctx)
      ? { ok: true }
      : { ok: false, reason: "signature mismatch" };
  };
}
