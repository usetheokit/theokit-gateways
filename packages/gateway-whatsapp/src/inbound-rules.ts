/**
 * Does an inbound WhatsApp message reach the agent, and as what?
 *
 * The sender allowlist, the group-mention rule and the conversion to the gateway's event shape,
 * as pure functions. `WhatsAppAdapter` holds the configuration and passes it in; every adapter
 * path that decides an inbound message calls `decideInbound`, so there is one rule set to keep.
 */

import type { WhatsAppMessageEvent } from "@theokit/gateway";

import { isSenderAllowed } from "./allowlist.js";
import type { WhatsAppInboundEvent } from "./backend-types.js";

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
  return (s.match(PHONE_RUN) ?? []).map(digitsOnly).filter((d) => d.length > 0);
}

/**
 * Is this sender refused by a configured allowlist?
 *
 * Runs before the group/mention filter because it answers a different question: that one asks
 * whether a message was meant for us, this one asks whether the sender may reach us at all.
 *
 * The refusal is logged. A silent drop is indistinguishable from a broken gateway, and the
 * first thing a mistyped allowlist causes is an operator wondering why the bot went mute.
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
    `[whatsapp] dropped inbound from "${inbound.fromPhone}" — not in the configured allowlist\n`,
  );
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
    // so matters more here than anywhere — the sibling allowlist check makes the same point
    // fifteen lines below, and a gateway that answers no group message and explains nothing
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
