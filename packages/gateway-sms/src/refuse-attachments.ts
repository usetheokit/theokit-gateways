/**
 * The refusal this adapter answers for an outbound that carries attachments (B-674).
 *
 * This adapter sends text only, so an outbound carrying attachments is refused rather than sent without its images.
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
    error: { code: "attachments_unsupported", message: "sms adapter cannot send attachments" },
  };
}
