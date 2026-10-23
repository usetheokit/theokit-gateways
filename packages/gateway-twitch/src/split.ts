/**
 * Cut outbound text into Twitch chat messages.
 *
 * @public
 */

import { chunkByGrapheme } from "@theokit/gateway";

/** Twitch's limit for one chat message, in characters. */
export const TWITCH_MESSAGE_LIMIT = 500;

/**
 * Split `text` into chat messages of at most 500 characters, never inside a grapheme, in order.
 *
 * @returns the parts; empty for an empty text
 * @public
 */
export function splitForTwitch(text: string): string[] {
  if (text.length === 0) return [];
  return chunkByGrapheme(text, { limit: TWITCH_MESSAGE_LIMIT }).filter((part) => part.length > 0);
}
