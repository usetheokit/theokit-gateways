/**
 * Cut outbound text into WeChat customer-service messages.
 *
 * @public
 */

import { chunkByGrapheme } from "@theokit/gateway";

/**
 * The most characters one message carries here. WeChat caps a text message at 2048 bytes of
 * UTF-8; 600 UTF-16 units is at most 1800 bytes (3 per unit for CJK), so a part always fits.
 */
export const WECHAT_MESSAGE_LIMIT = 600;

/**
 * Split `text` into messages of at most 600 characters, never inside a grapheme, in order.
 *
 * @returns the parts; empty for an empty text
 * @public
 */
export function splitForWeChat(text: string): string[] {
  if (text.length === 0) return [];
  return chunkByGrapheme(text, { limit: WECHAT_MESSAGE_LIMIT }).filter((part) => part.length > 0);
}
