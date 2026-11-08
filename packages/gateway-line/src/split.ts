/**
 * Grapheme-cluster-safe split for LINE outbound text (D411, EC-7), keeping table rows whole.
 *
 * LINE limits text messages to 5000 chars. A text within the limit goes through core
 * `chunkByGrapheme` as before. A longer one is cut at the last grapheme boundary within each part,
 * which is where `chunkByGrapheme`'s greedy walk ends a part, so emoji, regional indicators and
 * combining sequences are never severed and text with no table row splits exactly as it did
 * (pinned by `tests/split-no-table-baseline.test.ts` and the equivalence test in
 * `tests/split-tables.test.ts`).
 *
 * A cut that falls inside a Markdown table row which fits in a part moves back to the start of
 * that row, so the row arrives whole in the next message (B-556). The rule is core
 * `splitKeepingRows`, shared with gateway-sms.
 */

import { chunkByGrapheme, splitKeepingRows } from "@theokit/gateway";

export function splitForLine(text: string, limit = 5000): string[] {
  if (text.length <= limit) return chunkByGrapheme(text, { limit });
  // The core's RangeError for a limit of 0, 1.5 or NaN, with the message it had before.
  chunkByGrapheme("", { limit });
  return splitKeepingRows(text, limit);
}
