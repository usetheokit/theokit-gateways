/**
 * Does an inbound WhatsApp message reach the agent, and as what?
 *
 * The addressed-number check, the sender allowlist, the group-mention rule and the conversion to
 * the gateway's event shape, as functions of their inputs (the only state is the set of foreign
 * numbers already reported, which the caller owns). `WhatsAppAdapter` holds the configuration and
 * passes it in; every adapter path that decides an inbound message goes through
 * `toDeliverableEvent`, which calls `isForAnotherNumber` and `decideInbound`, so there is one rule
 * set to keep. `WhatsAppCloudBackend.handleWebhookPayload` calls `isForAnotherNumber` as well, for
 * messages and for status receipts, so a route built on the backend alone is scoped to its number
 * too.
 */

import type { WhatsAppMessageEvent } from "@theokit/gateway";

import { isSenderAllowed } from "./allowlist.js";
import type { WhatsAppInboundEvent, WhatsAppStatusReceipt } from "./backend-types.js";

/** The configuration the inbound rules read, held by the adapter. */
export interface InboundRules {
  /** `undefined` = no allowlist configured; a set = configured, and enforced fail-closed. */
  readonly allowedSenders: ReadonlySet<string> | undefined;
  /** Drop a group message that does not mention the bot. */
  readonly requireMention: boolean;
  /** The bot's number, digits only; `""` when unset. */
  readonly botPhoneId: string;
}

/** EC-7: digit-only normalizer for mention comparison (handles `+`, `-`, `()`, spaces). */
export function digitsOnly(s: string): string {
  return s.replace(/[^\d]/g, "");
}

/**
 * Characters that may appear INSIDE a written phone number: digits and the
 * separators people type around them. Anything else — a letter, a comma, a
 * newline — ends the run.
 */
const PHONE_RUN = /[\d][\d+\-().  ]*[\d]|[\d]/g;

/**
 * EC-7: the phone-like runs in a message, each normalized to digits.
 *
 * The filter used to normalize the WHOLE message and ask whether the result
 * contained the bot's number. That accepts the four documented formats, but it
 * also concatenates digits from unrelated words: with a bot at 5511999999999,
 * `"pedido 55 chegou 11, ref 99999-9999 ok"` normalized to a string containing
 * exactly that number, and the bot answered a message about an order. Every
 * group message carrying scattered digits woke it.
 *
 * Scanning runs instead keeps the separators irrelevant WITHIN a number — which
 * is what EC-7 asks for, and what `"+55 (11) 99999-9999"` needs — while letting
 * a letter or a comma do what it visually does: end the number.
 */
function phoneRuns(s: string): string[] {
  // Every match starts and ends with a digit, so no run normalizes to "".
  return (s.match(PHONE_RUN) ?? []).map(digitsOnly);
}

/**
 * Is this sender refused by a configured allowlist?
 *
 * Runs before the group/mention filter because it answers a different question: that one asks
 * whether a message was meant for us, this one asks whether the sender may reach us at all.
 *
 * The refusal is logged, with the sender's address reduced to its last four digits. A silent drop
 * is indistinguishable from a broken gateway, and the first thing a mistyped allowlist causes is
 * an operator wondering why the bot went mute.
 */
function isRefusedBySenderAllowlist(
  inbound: WhatsAppInboundEvent,
  allowedSenders: ReadonlySet<string> | undefined,
): boolean {
  // The allowlist answers "may this STRANGER reach the agent?", and the account owner writing
  // in their own self-chat is not one. It also cannot answer it here: the self-chat reports the
  // account's LID as the sender, while an operator writes a phone number — measured on a real
  // paired session. Reading the flag rather than the address keeps the exemption tied to the
  // backend's own decision, so a stranger arriving on a LID is still refused.
  if (inbound.fromSelf === true) return false;
  if (allowedSenders === undefined) return false;
  if (isSenderAllowed(inbound.fromPhone, allowedSenders)) return false;
  process.stderr.write(
    `[whatsapp] dropped inbound from ${redactedSender(inbound.fromPhone)}: not in the configured allowlist\n`,
  );
  return true;
}

/**
 * A refused sender as the log names it: the last four digits of the address, enough to match a
 * mistyped allowlist entry by eye. The full number is personal data of someone who never agreed
 * to reach this bot, and every unsolicited message would otherwise write it to the host's logs.
 */
function redactedSender(fromPhone: string): string {
  const tail = lastFourDigits(fromPhone);
  return tail.length > 0 ? `a sender ending in ${tail}` : "a sender with no number";
}

/** The last four digits of `value`, `""` when it has none. Every other character is dropped. */
function lastFourDigits(value: string): string {
  return digitsOnly(value).slice(-4);
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

/** D309 + EC-7: group filter with digit-only normalization. */
function shouldDropGroupMessage(
  inbound: WhatsAppInboundEvent,
  requireMention: boolean,
  botPhoneId: string,
): boolean {
  if (inbound.conversationType !== "group" || !requireMention) return false;
  if (botPhoneId.length === 0) {
    // Misconfigured: with no id to look for, every group message looks unaddressed. Saying
    // so matters more here than anywhere: the allowlist check above (isRefusedBySenderAllowlist)
    // makes the same point, and a gateway that answers no group message and explains nothing
    // is indistinguishable from a broken one. Common with `fromWeb`, which has no phone
    // number id to default from.
    process.stderr.write(
      "[whatsapp] dropping every group message: requireMention is on and botPhoneId is unset\n",
    );
    return true;
  }
  return !phoneRuns(inbound.text).some((run) => run.includes(botPhoneId));
}

function toMessageEvent(inbound: WhatsAppInboundEvent): WhatsAppMessageEvent {
  return {
    id: inbound.wamid,
    platform: "whatsapp",
    sender: { id: inbound.fromPhone, displayName: inbound.contactName },
    channel: { id: inbound.channelId, type: inbound.conversationType },
    text: inbound.text,
    receivedAt: inbound.receivedAt,
    whatsapp: {
      wamid: inbound.wamid,
      phoneNumberId: inbound.phoneNumberId,
      contactName: inbound.contactName,
      channelJid: inbound.channelJid,
      backend: inbound.backend,
      raw: inbound.raw,
    },
  };
}

/**
 * Decide one inbound message: the event the agent receives, or `undefined` when a rule drops it.
 *
 * The allowlist runs first, then the group rule, then the conversion, so a refused sender is
 * named once and never reaches the group logging. A drop writes its reason to stderr.
 */
export function decideInbound(
  inbound: WhatsAppInboundEvent,
  rules: InboundRules,
): WhatsAppMessageEvent | undefined {
  if (isRefusedBySenderAllowlist(inbound, rules.allowedSenders)) return undefined;
  if (shouldDropGroupMessage(inbound, rules.requireMention, rules.botPhoneId)) return undefined;
  return toMessageEvent(inbound);
}
