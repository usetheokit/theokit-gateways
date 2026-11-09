/**
 * Direct-message encryption: NIP-17 gift wraps (NIP-59 over NIP-44) and NIP-04, both through
 * `nostr-tools`. No cryptography is written here.
 */

import { decrypt as nip04Decrypt, encrypt as nip04Encrypt } from "nostr-tools/nip04";
import { createRumor, createSeal, createWrap, unwrapEvent } from "nostr-tools/nip59";
import { finalizeEvent, type NostrEvent } from "nostr-tools/pure";

/** A NIP-17 private direct message. */
export const DM_KIND = 14;
/** A NIP-04 encrypted direct message. */
export const NIP04_KIND = 4;

/** A decrypted direct message: who wrote it, what it says, and which scheme carried it. */
export interface OpenedMessage {
  /** The rumor's id for NIP-17, the event's id for NIP-04. */
  readonly id: string;
  /** The author's public key: the rumor's for NIP-17, never the wrap's throwaway key. */
  readonly pubkey: string;
  readonly kind: typeof DM_KIND | typeof NIP04_KIND;
  readonly createdAt: number;
  readonly text: string;
  /** The rumor (NIP-17) or the event (NIP-04). */
  readonly raw: unknown;
}

/**
 * Open a kind 1059 gift wrap addressed to `secretKey`.
 *
 * @throws Error when the wrap does not decrypt, its seal is not signed, the rumor's author differs
 *   from the seal's (EC-5), or the rumor is not a kind 14 message
 */
export function openGiftWrap(wrap: NostrEvent, secretKey: Uint8Array): OpenedMessage {
  const rumor = unwrapEvent(wrap, secretKey);
  if (rumor.kind !== DM_KIND) throw new Error(`rumor kind ${rumor.kind} is not ${DM_KIND}`);
  return {
    id: rumor.id,
    pubkey: rumor.pubkey,
    kind: DM_KIND,
    createdAt: rumor.created_at,
    text: rumor.content,
    raw: rumor,
  };
}

/**
 * Decrypt a kind 4 event addressed to `secretKey`.
 *
 * @throws Error when the content does not decrypt with the sender's key
 */
export function openNip04(event: NostrEvent, secretKey: Uint8Array): OpenedMessage {
  return {
    id: event.id,
    pubkey: event.pubkey,
    kind: NIP04_KIND,
    createdAt: event.created_at,
    text: nip04Decrypt(secretKey, event.pubkey, event.content),
    raw: event,
  };
}

/** The two gift wraps of one NIP-17 message and the id of the rumor they carry. */
export interface SealedMessage {
  readonly rumorId: string;
  /** Addressed to the recipient. */
  readonly toRecipient: NostrEvent;
  /** Addressed to the sender, so its other clients see what it sent. */
  readonly toSelf: NostrEvent;
}

/** Wrap `text` from `secretKey` to `recipient` as a NIP-17 message, with the sender's own copy. */
export function sealDirectMessage(
  secretKey: Uint8Array,
  ownPubkey: string,
  recipient: string,
  text: string,
): SealedMessage {
  const rumor = createRumor(
    { kind: DM_KIND, content: text, tags: [["p", recipient]], created_at: nowSeconds() },
    secretKey,
  );
  return {
    rumorId: rumor.id,
    toRecipient: createWrap(createSeal(rumor, secretKey, recipient), recipient),
    toSelf: createWrap(createSeal(rumor, secretKey, ownPubkey), ownPubkey),
  };
}

/** Encrypt `text` from `secretKey` to `recipient` as a signed NIP-04 kind 4 event. */
export function sealNip04(secretKey: Uint8Array, recipient: string, text: string): NostrEvent {
  return finalizeEvent(
    {
      kind: NIP04_KIND,
      content: nip04Encrypt(secretKey, recipient, text),
      tags: [["p", recipient]],
      created_at: nowSeconds(),
    },
    secretKey,
  );
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
