/**
 * The refusal this adapter answers for an outbound that carries attachments (B-674).
 *
 * Used by `editMessage` only: Telegram has no call that adds an image to a sent message, so an edit carrying one is refused rather than applied as text alone. `sendMessage` sends attachments through `send-photos.ts`.
 *
 * The check runs before any other, so a refusal makes no platform call. It lives in this package
 * rather than in `@theokit/gateway` so that the adapter calls nothing its declared core floor
 * lacks; only the `OutboundMessage` type is imported.
 */

import type { OutboundMessage, SendResult } from "@theokit/gateway";

/**
 * `attachments_unsupported` when `out` carries attachments, otherwise `undefined`.
 *
 * Absent, `null` and an empty list carry nothing. `!== 0`, not `> 0`: any other non-array value
 * from a JavaScript caller has no numeric length and is refused rather than taken for an empty
 * list (EC-1).
 */
export function refuseAttachments(out: OutboundMessage): SendResult | undefined {
  if (out.attachments == null || out.attachments.length === 0) return undefined;
  return {
    ok: false,
    error: {
      code: "attachments_unsupported",
      message: "telegram adapter cannot attach to an edit",
    },
  };
}
