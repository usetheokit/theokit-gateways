/**
 * The bot's Nostr secret key, read from either of the two spellings operators hold it in.
 */

import { decode } from "nostr-tools/nip19";
import { getPublicKey } from "nostr-tools/pure";

const HEX_KEY = /^[0-9a-fA-F]{64}$/;
const MESSAGE = "secretKey must be an nsec1 key or 64 hex characters";

/**
 * A secret key that is neither an `nsec1` key nor 64 hex characters naming a valid secp256k1
 * scalar. The message never carries any part of the value.
 *
 * @public
 */
export class NostrKeyError extends Error {
  constructor() {
    super(MESSAGE);
    this.name = "NostrKeyError";
  }
}

/**
 * Parse a Nostr secret key.
 *
 * @param value an `nsec1…` key or 64 hex characters, in either case
 * @returns the 32 key bytes
 * @throws NostrKeyError when `value` is neither, or names no valid key (64 zeros, a value past the
 *   curve order)
 * @public
 */
export function parseNostrSecretKey(value: string): Uint8Array {
  const bytes = decodeKey(value);
  try {
    getPublicKey(bytes);
  } catch {
    throw new NostrKeyError();
  }
  return bytes;
}

function decodeKey(value: string): Uint8Array {
  if (HEX_KEY.test(value)) return new Uint8Array(Buffer.from(value, "hex"));
  if (!value.startsWith("nsec1")) throw new NostrKeyError();
  try {
    const decoded = decode(value);
    if (decoded.type === "nsec") return decoded.data;
  } catch {
    // A malformed bech32 string; the decoder's own message quotes it, so it is not passed on.
  }
  throw new NostrKeyError();
}
