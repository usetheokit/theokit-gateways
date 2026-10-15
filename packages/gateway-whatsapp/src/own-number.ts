/**
 * The fail-closed precondition of the adapter methods a route calls with an unfiltered Cloud
 * envelope (docs/adr/0006).
 *
 * @internal
 */

import type { WhatsAppMessageEvent } from "@theokit/gateway";

import type { WhatsAppInboundEvent } from "./backend-types.js";
import { ConfigurationError } from "./errors.js";
import { decideInbound, type InboundRules, isForAnotherNumber } from "./inbound-rules.js";

/**
 * The event the agent receives for `inbound`, or `undefined` when it is addressed to another number
 * than `ownPhoneNumberId` or a rule of `decideInbound` drops it.
 *
 * `onInbound` calls this without `requireOwnPhoneNumberId`: a backend that declares no number and
 * still delivers Cloud messages filtered them by its own number first (a wrapped
 * `WhatsAppCloudBackend` does), so only the methods a route hands an unfiltered envelope fail closed.
 */
export function decideForOwnNumber(
  inbound: WhatsAppInboundEvent,
  ownPhoneNumberId: string | undefined,
  reported: Set<string>,
  rules: InboundRules,
): WhatsAppMessageEvent | undefined {
  if (isForAnotherNumber(inbound, ownPhoneNumberId, reported)) return undefined;
  return decideInbound(inbound, rules);
}

/**
 * The phone number id the adapter's backend declares, or a `missing_phone_number_id`
 * `ConfigurationError` naming `method` when it declares none. One Meta app signs every number's
 * webhooks with one secret, so with no number to compare, every number's messages would reach the
 * adapter's agent.
 */
export function requireOwnPhoneNumberId(
  ownPhoneNumberId: string | undefined,
  method: string,
): string {
  if (ownPhoneNumberId !== undefined) return ownPhoneNumberId;
  throw new ConfigurationError({
    code: "missing_phone_number_id",
    message:
      `gateway-whatsapp: ${method} needs the backend to declare its phoneNumberId. ` +
      "One Meta app signs every number's webhooks with one secret, so without it this adapter " +
      "would deliver every number's messages. Use fromCloud, or expose phoneNumberId on a " +
      "backend that wraps WhatsAppCloudBackend.",
  });
}
