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
import { normalizeE164 } from "./phone.js";
import type { SMSAdapterOptions } from "./types.js";

/**
 * Translate one raw provider webhook into an {@link SMSMessageEvent}.
 *
 * Returns `null` — never throws — when the body is not one this provider recognises. The caller is
 * TheoKit's `onMessage`, which runs AFTER the 200 has been sent, so a throw there is an unhandled
 * rejection in the app's request path rather than an error anyone sees (ADR D428).
 *
 * `null` here means only "this body is not a parseable inbound message"; unlike Telegram, SMS
 * providers do not post update kinds that are ordinary-but-empty.
 *
 * @public
 */
export function parseInbound(
  options: SMSAdapterOptions,
  ctx: SignatureContext,
): SMSMessageEvent | null {
  // Validate the APP's own configuration first, and let it throw. After this line a
  // `ConfigurationError` can only have come from a number in the body, which is a bad request
  // rather than a bad deployment — and the two are indistinguishable by type, since `normalizeE164`
  // raises the same error for both. Ordering is what separates them.
  //
  // Measured, and the reason this exists: with a single broad `catch`, an invalid `fromNumber` in
  // the app's options made every message return `null`. The app would have seen silent drops with
  // nothing to diagnose. With no catch at all, an empty webhook body threw `ConfigurationError` out
  // of `onMessage` — after TheoKit had already answered 200.
  normalizeE164(options.fromNumber);

  let inbound: SMSInbound;
  try {
    inbound = createBackend(options).parseInbound(ctx);
  } catch {
    // Reaching here means the body was unreadable, whatever the error's type — the configuration
    // already passed the check above, so nothing here can be a programmer error.
    //
    // Deliberately catches everything. An earlier version re-threw anything that was not a
    // `ConfigurationError`, and a body containing a malformed percent-escape (`From=%zz`) then
    // escaped as `URIError: URI malformed` — out of `onMessage`, which TheoKit calls AFTER
    // answering 200. That is the unhandled rejection ADR D428 exists to prevent, and no test caught
    // it: the mutation that should have gone red stayed green, which is the only signal an untested
    // branch gives.
    return null;
  }

  // Shape checks, not error handling: a body the provider posted that carries no message.
  if (inbound.messageId === "" || inbound.from === "") return null;

  return inboundToMessageEvent(inbound, options.backend);
}
