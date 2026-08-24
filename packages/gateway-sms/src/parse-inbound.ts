/**
 * Translating a raw provider webhook into the canonical event.
 *
 * **This does NOT go through TheoKit's `handleChannelWebhook`.** Signature verification here needs
 * the RAW body, the headers and the exact URL — `ChannelMessage` carries none of the three, so the
 * check cannot be performed from inside `onMessage` whatever the provider sends. Twilio adds a
 * second obstacle: it posts `application/x-www-form-urlencoded`, and that seam reads the body with
 * `request.json()` and answers 400 when it is not JSON. (Plivo accepts either encoding and Vonage
 * posts JSON, so only the first reason applies to them.) Use `createWebhookServer`,
 * which builds the {@link SignatureContext} from the request, or call this from your own route
 * where you still hold the unparsed body. It composes two functions that
 * already existed and were both private: each backend's `parseInbound`, which turns a provider's
 * form body into the provider-agnostic {@link SMSInbound}, and `inboundToMessageEvent`, which turns
 * that into the canonical event. Neither is duplicated here — per ADR D426 the mapping stays in one
 * place, and this is composition, not a second translator.
 *
 * **Why it takes the adapter's options.** Parsing is provider-specific (`Twilio` posts
 * `MessageSid`, Plivo posts `MessageUUID`) and, for Twilio, country-dependent: a number that is not
 * already in E.164 is normalised against `defaultCountry`. Both live in the options an app already
 * holds, because it constructed the adapter with them. `createBackend` only stores them — it opens
 * no connection and loads no SDK, so this stays a pure function over its inputs.
 */

import type { SMSMessageEvent } from "@theokit/gateway";

import { createBackend } from "./backend/index.js";
import type { SignatureContext, SMSInbound } from "./backend-types.js";
import { inboundToMessageEvent } from "./normalize.js";
import type { SMSAdapterOptions } from "./types.js";

/**
 * Translate one raw provider webhook into an {@link SMSMessageEvent}.
 *
 * Returns `null` — never throws — when the body is not one this provider recognises. The caller is
 * whatever holds the {@link SignatureContext}: `createWebhookServer` here, or your own route. It
 * returns `null` rather than throwing because a throw out of a webhook handler becomes a failed
 * request, and the provider then sees a delivery failure for a body that was merely unrecognised
 * (ADR D428, whose original rationale — "runs after the 200" — was measured false on 2026-08-24).
 *
 * `null` here means "this body is not a parseable inbound message".
 *
 * **One class of configuration error is not distinguishable from a bad body, and is not pretended
 * to be.** `defaultCountry` is read while parsing the body's own numbers, and `normalizeE164`
 * raises the same `ConfigurationError` for a bad configured country as for a bad number in the
 * body. An invalid `defaultCountry` therefore degrades to `null` rather than throwing.
 *
 * An earlier version tried to separate them by validating `options.fromNumber` up front. That was
 * wrong twice: `fromNumber` is passed raw to the provider SDK everywhere else in this package and
 * validated nowhere, and the invented rule rejected four documented, valid configurations — a
 * Vonage alphanumeric sender ID (`"ACME"`), a Twilio short code (`"12345"`), a Messaging Service
 * SID (`"MG…"`), and a national number with `defaultCountry` set. Each one threw out of
 * `onMessage`, turning a message the provider delivered into a failed request — precisely the
 * failure the check was written to prevent.
 * Inventing a validation stricter than the package's own is how that happened.
 *
 * @public
 */
export function parseInbound(
  options: SMSAdapterOptions,
  ctx: SignatureContext,
): SMSMessageEvent | null {
  // `createBackend` is the CONFIGURATION step and sits outside the try on purpose: an unsupported
  // `backend` is a programmer error and must surface, not become the same `null` a malformed body
  // produces.
  const backend = createBackend(options);

  let inbound: SMSInbound;
  try {
    inbound = backend.parseInbound(ctx);
  } catch {
    // Everything from here is body-dependent, so any error means the body was unreadable. Caught
    // whatever its type: `decodeURIComponent` raises `URIError` on a malformed percent-escape
    // (`From=%zz`) and `normalizeE164` raises `ConfigurationError` on a number the body carried.
    // Both are bad requests, and returning `null` is what keeps them from failing the request:
    // measured against `theokit@0.48.14`, `handleChannelWebhook` awaits `onMessage` BEFORE
    // building the 200 and catches nothing around it, so a throw here escapes it entirely and
    // the 200 is never built (ADR D428, whose original rationale — "runs after the 200" — was
    // measured false on 2026-08-24).
    return null;
  }

  // A body the provider posted that carries no message id.
  //
  // Deliberately does NOT also check `inbound.from === ""`: all three backends build `from` with
  // `normalizeE164(x ?? "")`, which throws on an empty string, so the branch was unreachable and a
  // mutation deleting it survived the suite.
  if (inbound.messageId === "") return null;

  return inboundToMessageEvent(inbound, options.backend);
}
