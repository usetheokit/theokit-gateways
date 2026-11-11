/**
 * Cut outbound text into QQ Bot messages.
 *
 * @public
 */

import { chunkByGrapheme } from "@theokit/gateway";

/** The most characters one message carries here; QQ caps a text message well above this. */
export const QQ_MESSAGE_LIMIT = 1500;

/**
 * Split `text` into messages of at most 1500 characters, never inside a grapheme, in order.
 *
 * @returns the parts; empty for an empty text
 * @public
 */
export function splitForQQ(text: string): string[] {
  if (text.length === 0) return [];
  return chunkByGrapheme(text, { limit: QQ_MESSAGE_LIMIT }).filter((part) => part.length > 0);
}
