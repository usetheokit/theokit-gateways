/**
 * Cut outbound text into Zalo messages.
 *
 * @public
 */

import { chunkByGrapheme } from "@theokit/gateway";

/** The most characters one Zalo message carries. */
export const ZALO_PERSONAL_MESSAGE_LIMIT = 2000;

/**
 * Split `text` into messages of at most 2000 characters, never inside a grapheme, in order.
 *
 * @returns the parts; empty for an empty text
 * @public
 */
export function splitForZaloPersonal(text: string): string[] {
  if (text.length === 0) return [];
  return chunkByGrapheme(text, { limit: ZALO_PERSONAL_MESSAGE_LIMIT }).filter(
    (part) => part.length > 0,
  );
}
