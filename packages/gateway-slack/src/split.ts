/**
 * Split a long string into ≤4000-char chunks for `chat.postMessage` (ADR D272).
 *
 * Thin wrapper over core `chunkText` (roadmap M1) — single-sources the
 * boundary-preferring chunking knowledge. Slack family: fixed 4000 window,
 * `\n\n` → `\n` → ` ` boundary preference, UTF-16 surrogate-pair guard
 * (EC-4), leading-whitespace strip on continuation. Output is byte-identical
 * to the previous hand-rolled implementation (pinned by `tests/split.test.ts`).
 *
 * @internal
 */

import { chunkText } from "@theokit/gateway";

const SLACK_MAX_TEXT = 4000;

export function splitForSlack(text: string): string[] {
  return chunkText(text, {
    limit: SLACK_MAX_TEXT,
    boundaries: ["\n\n", "\n", " "],
    lastResort: "last-boundary",
    surrogateGuard: true,
    stripLeading: /^\s+/,
    keepTableRows: true,
  });
}
