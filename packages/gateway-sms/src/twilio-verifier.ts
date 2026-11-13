/**
 * Standalone Twilio request verifier.
 *
 * Twilio signs voice webhooks exactly like SMS webhooks: `X-Twilio-Signature` is the base64
 * HMAC-SHA1 (keyed with the auth token) of the full URL followed by every POST parameter, sorted by
 * name, as `name + value`. No adapter and no `twilio` SDK are needed.
 *
 * @public
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type { WebhookVerifyResult } from "./webhook-verifier.js";

/** Options for {@link twilioRequestVerifier}. @public */
export interface TwilioRequestVerifierOptions {
  /** The Twilio auth token the signature is keyed with. */
  readonly authToken: string;
  /**
   * The URL Twilio POSTs to, as Twilio sees it. Defaults to the request URL, which behind a proxy
   * or tunnel is the internal one and will not match.
   */
  readonly publicUrl?: string;
}

function decode(s: string): string {
  return decodeURIComponent(s.replace(/\+/g, " "));
}

/** Parse a form body keeping repeated keys: Twilio signs every value of a repeated name. */
function parseForm(body: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const pair of body.split("&")) {
    if (pair.length === 0) continue;
    const eq = pair.indexOf("=");
    out.push([decode(eq < 0 ? pair : pair.slice(0, eq)), decode(eq < 0 ? "" : pair.slice(eq + 1))]);
  }
  return out;
}

function compare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function sign(authToken: string, url: string, pairs: Array<[string, string]>): string {
  const sorted = [...pairs].sort((x, y) => compare(x[0], y[0]) || compare(x[1], y[1]));
  let data = url;
  for (const [k, v] of sorted) data += k + v;
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

/**
 * Build a verifier for Twilio webhooks (SMS or voice).
 *
 * The request body is READ; pass a clone if it is needed afterwards.
 *
 * @public
 */
export function twilioRequestVerifier(
  opts: TwilioRequestVerifierOptions,
): (request: Request) => Promise<WebhookVerifyResult> {
  return async (request: Request): Promise<WebhookVerifyResult> => {
    const header = request.headers.get("x-twilio-signature");
    if (header === null || header.length === 0) {
      return { ok: false, reason: "missing X-Twilio-Signature header" };
    }
    let pairs: Array<[string, string]>;
    try {
      pairs = parseForm(await request.text());
    } catch {
      return { ok: false, reason: "unparseable body" };
    }
    const expected = Buffer.from(sign(opts.authToken, opts.publicUrl ?? request.url, pairs));
    const actual = Buffer.from(header);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { ok: false, reason: "signature mismatch" };
    }
    return { ok: true };
  };
}
