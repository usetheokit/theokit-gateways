/**
 * Translating a raw provider webhook into the canonical event.
 *
 * This is the gateway's half of TheoKit's channel seam for SMS. It composes two functions that
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
 * TheoKit's `onMessage`, which runs AFTER the 200 has been sent, so a throw there is an unhandled
 * rejection in the app's request path rather than an error anyone sees (ADR D428).
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
 * `onMessage` after the 200, which is precisely the failure the check was written to prevent.
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
    // Both are bad requests, and `onMessage` runs AFTER TheoKit answered 200 — a throw here is an
    // unhandled rejection with no status left to change (ADR D428).
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
