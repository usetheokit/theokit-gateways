/**
 * Text-only helpers shared by the realtime bot adapters.
 */

import { chunkByGrapheme, type OutboundMessage, type SendResult } from "@theokit/gateway";

/**
 * `attachments_unsupported` when `out` carries attachments, otherwise `undefined`.
 *
 * Absent, `null` and an empty list carry nothing. `!== 0`, not `> 0`: any other non-array value
 * from a JavaScript caller has no numeric length and is refused rather than taken for an empty
 * list. The check makes no platform call.
 */
export function refuseAttachments(out: OutboundMessage, platform: string): SendResult | undefined {
  if (out.attachments == null || out.attachments.length === 0) return undefined;
  return {
    ok: false,
    error: {
      code: "attachments_unsupported",
      message: `${platform} adapter cannot send attachments`,
    },
  };
}

/** Split `text` into parts of at most `limit` characters, never inside a grapheme, in order. */
export function splitText(text: string, limit: number): string[] {
  if (text.length === 0) return [];
  return chunkByGrapheme(text, { limit }).filter((part) => part.length > 0);
}
