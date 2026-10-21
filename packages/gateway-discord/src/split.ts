/**
 * Discord's 2000-char per-message hard limit. Split agent responses on safe
 * boundaries before sending (T6.1).
 *
 * Thin wrapper over core `chunkText` (roadmap M1). Telegram family (minus
 * markdown balancing): 2000 hard cap, 1900 soft window, `\n\n` → `\n` → window
 * boundary preference, newline-only leading strip, no surrogate guard. Output
 * is byte-identical to the previous implementation (pinned by
 * `tests/split.test.ts`).
 *
 * @internal
 */

import { chunkText } from "@theokit/gateway";

export const DISCORD_MAX_MESSAGE = 2000;
const SAFE_DISCORD_CHUNK = 1900;
const BOUNDARIES = {
  boundaries: ["\n\n", "\n"],
  lastResort: "window",
  stripLeading: /^\n+/,
} as const;

export function splitForDiscord(text: string): string[] {
  return chunkText(text, {
    limit: DISCORD_MAX_MESSAGE,
    safeLimit: SAFE_DISCORD_CHUNK,
    ...BOUNDARIES,
  });
}

/**
 * Split a text that is escaped after the split, at half the cap.
 *
 * Escaping adds at most one backslash per character, so a part of at most 1000 characters fits
 * one message once escaped. The adapter calls this only for a part whose escaped body passed the
 * cap, so the parts of an ordinary text are the ones `splitForDiscord` returns.
 */
export function splitForEscapedDiscord(text: string): string[] {
  return chunkText(text, {
    limit: DISCORD_MAX_MESSAGE / 2,
    safeLimit: SAFE_DISCORD_CHUNK / 2,
    ...BOUNDARIES,
  });
}
