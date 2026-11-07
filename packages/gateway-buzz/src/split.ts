/**
 * Cut outbound text into Buzz messages.
 *
 * @public
 */

import { chunkByGrapheme } from "@theokit/gateway";

/**
 * The most characters one message is cut to. Buzz documents no hard limit that this package
 * could confirm offline, so this is a conservative size, not a measured server limit.
 */
export const BUZZ_MESSAGE_LIMIT = 4000;

/**
 * Split `text` into messages of at most 4000 characters, never inside a grapheme, in order.
 *
 * @returns the parts; empty for an empty text
 * @public
 */
export function splitForBuzz(text: string): string[] {
  if (text.length === 0) return [];
  return chunkByGrapheme(text, { limit: BUZZ_MESSAGE_LIMIT }).filter(
    (part) => part.length > 0,
  );
}
