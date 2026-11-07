/**
 * Cut outbound text into ClickClack messages.
 *
 * @public
 */

import { chunkByGrapheme } from "@theokit/gateway";

/**
 * The most characters one message is cut to. ClickClack documents no hard limit that this package
 * could confirm offline, so this is a conservative size, not a measured server limit.
 */
export const CLICKCLACK_MESSAGE_LIMIT = 4000;

/**
 * Split `text` into messages of at most 4000 characters, never inside a grapheme, in order.
 *
 * @returns the parts; empty for an empty text
 * @public
 */
export function splitForClickClack(text: string): string[] {
  if (text.length === 0) return [];
  return chunkByGrapheme(text, { limit: CLICKCLACK_MESSAGE_LIMIT }).filter(
    (part) => part.length > 0,
  );
}
