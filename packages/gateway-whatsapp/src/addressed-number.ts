/**
 * Which phone number an inbound message or status receipt was addressed to.
 *
 * The multi-number scoping rule, apart from the sender rules in inbound-rules.ts. The adapter
 * (through `decideForOwnNumber`) and `WhatsAppCloudBackend.handleWebhookPayload`, for messages and
 * for status receipts, both call `isForAnotherNumber`, so a route built on the backend alone is
 * scoped to its number too.
 */

import type { WhatsAppInboundEvent, WhatsAppStatusReceipt } from "./backend-types.js";

/** The last four digits of `value`, `""` when it has none. Every other character is dropped. */
export function lastFourDigits(value: string): string {
  return value.replace(/[^\d]/g, "").slice(-4);
}

/**
 * A foreign phone number id as the log names it, cut the way `redactedSender` cuts a sender: its
 * last four digits. The id comes from an envelope, and `toDeliverableEvents` does not verify the
 * signature, so a route that skips verification hands this function text anyone wrote. Keeping
 * digits only means no newline or quote reaches stderr.
 */
function redactedNumberId(phoneNumberId: string | undefined): string {
  if (phoneNumberId === undefined) return "no phone number id";
  const tail = lastFourDigits(phoneNumberId);
  return tail.length > 0
    ? `a phone number id ending in ${tail}`
    : "a phone number id with no digits";
}

/**
 * Is this message, or status receipt, addressed to a Cloud number other than `ownPhoneNumberId`?
 *
 * Meta signs every number of one app with one secret, so a valid signature does not say which
 * number an envelope was for. `undefined` means the adapter has no Cloud number to compare, and
 * nothing is dropped. A message with no phone number id is not provably this number's, and is
 * dropped too.
 *
 * The foreign id reaches stderr only as its last four digits (see `redactedNumberId`), once per
 * label: `reported` holds the labels already written, and this function adds to it. Keyed by the
 * label rather than the raw id, the set is bounded: 10,000 endings plus the two labels for an id
 * with no digit and for no id, however many distinct ids an unverified caller sends. Two foreign
 * ids sharing an ending are named once, which is the cost of that bound.
 */
export function isForAnotherNumber(
  inbound: Pick<WhatsAppInboundEvent | WhatsAppStatusReceipt, "phoneNumberId">,
  ownPhoneNumberId: string | undefined,
  reported: Set<string>,
): boolean {
  if (ownPhoneNumberId === undefined || inbound.phoneNumberId === ownPhoneNumberId) return false;
  const other = redactedNumberId(inbound.phoneNumberId);
  if (!reported.has(other)) {
    reported.add(other);
    process.stderr.write(
      `[whatsapp] dropped inbound addressed to ${other}: this adapter answers for "${ownPhoneNumberId}". Logged once per id ending.\n`,
    );
  }
  return true;
}
