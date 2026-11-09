/**
 * How a declared outbound format becomes a Teams activity's `textFormat`.
 *
 * Moved out of `adapter.ts` unchanged (B-674) to keep that file within its 500-line budget.
 */

import type { OutboundMessage } from "@theokit/gateway";

/**
 * The `textFormat` fragment for a declared format, or nothing.
 *
 * A named function rather than a spread ternary inside the activity literal: `sendMessage` was
 * already at its cognitive-complexity limit, and a branch buried in an object literal is the
 * kind a reader skims past.
 */
export function activityFormat(format: OutboundMessage["format"]): {
  textFormat?: "markdown" | "xml";
} {
  // Teams has TWO markup types and they are not interchangeable. Declaring `html` as markdown
  // — which the first version did — makes the tags render literally AND emphasises any `*` or
  // `_` in the payload, so the caller gets the opposite of both intentions. Caught in review.
  if (format === "markdown") return { textFormat: "markdown" };
  if (format === "html") return { textFormat: "xml" };
  return {};
}
