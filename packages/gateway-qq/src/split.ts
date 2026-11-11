/**
 * Cut outbound text into QQ Bot messages.
 *
 * @public
 */

import { chunkByGrapheme } from "@theokit/gateway";

/**
 * The most characters one message is cut to. QQ documents no text limit that this package could
 * confirm offline, so this is a conservative size, not a measured server limit.
 */
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
