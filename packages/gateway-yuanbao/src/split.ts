/**
 * Cut outbound text into Yuanbao bot messages.
 *
 * @public
 */

import { chunkByGrapheme } from "@theokit/gateway";

/** The most characters one message carries here; a conservative cut, not a documented cap. */
export const YUANBAO_MESSAGE_LIMIT = 2000;

/**
 * Split `text` into messages of at most 2000 characters, never inside a grapheme, in order.
 *
 * @returns the parts; empty for an empty text
 * @public
 */
export function splitForYuanbao(text: string): string[] {
  if (text.length === 0) return [];
  return chunkByGrapheme(text, { limit: YUANBAO_MESSAGE_LIMIT }).filter((part) => part.length > 0);
}
