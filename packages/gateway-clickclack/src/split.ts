/**
 * Cut outbound text into ClickClack messages.
 *
 * @public
 */

import { splitText } from "@theokit/gateway-bot-realtime";

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
  return splitText(text, CLICKCLACK_MESSAGE_LIMIT);
}
