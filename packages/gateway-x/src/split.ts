/**
 * Cut outbound text into posts.
 *
 * @public
 */

import { chunkByGrapheme } from "@theokit/gateway";

/** The most characters one post carries here (the standard, non-premium limit). */
export const X_POST_LIMIT = 280;

/**
 * Split `text` into posts of at most 280 characters, never inside a grapheme, in order.
 *
 * @returns the parts; empty for an empty text
 * @public
 */
export function splitForX(text: string): string[] {
  if (text.length === 0) return [];
  return chunkByGrapheme(text, { limit: X_POST_LIMIT }).filter((part) => part.length > 0);
}
