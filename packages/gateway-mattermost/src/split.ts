/**
 * `splitForMattermost` — segment outbound text to Mattermost's post cap.
 *
 * This package shipped without any splitting at all, alone among the ten
 * adapters. `sendMessage` handed `out.text` to `createPost` whole, so an agent
 * reply longer than the cap came back:
 *
 *   HTTP 400 — "Post Message property is longer than the maximum permitted length."
 *
 * and the user saw nothing. No unit test could catch it, because there was no
 * cap in the code to assert against; it took a real server to answer 400.
 * Verified against Mattermost directly on 2026-08-17: 16000 chars posts fine,
 * 16384 is refused.
 *
 * The server counts RUNES, not bytes — `MaxPostSize` is 16383 by default. This
 * splits on code points via the core chunker, which is the closest the JS side
 * gets without walking graphemes; a message of astral-plane characters could
 * still exceed the server's count, which is why the window leaves headroom.
 *
 * @internal
 */

import { chunkText } from "@theokit/gateway";

/** Mattermost's default `MaxPostSize`, in runes. */
export const MATTERMOST_MAX_POST = 16_383;

/**
 * Cut inside a smaller window than the cap.
 *
 * The headroom absorbs the gap between how JavaScript counts a string and how
 * the server counts runes. Landing exactly on the limit is the one place this
 * can still fail, and the failure is a 400 the user never sees.
 */
const SAFE_CHUNK = 16_000;

export function splitForMattermost(text: string): string[] {
  return chunkText(text, {
    limit: MATTERMOST_MAX_POST,
    safeLimit: SAFE_CHUNK,
    boundaries: ["\n\n", "\n", " "],
    lastResort: "last-boundary",
    stripLeading: /^\s+/,
  });
}
