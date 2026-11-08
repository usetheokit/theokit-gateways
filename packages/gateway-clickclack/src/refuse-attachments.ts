/**
 * The refusal this adapter answers for an outbound that carries attachments (B-674).
 *
 * This adapter sends text only, so an outbound carrying attachments is refused rather than sent
 * without its images. The check runs before any other, so a refusal makes no platform call.
 */

import type { OutboundMessage, SendResult } from "@theokit/gateway";
import { refuseAttachments as refuse } from "@theokit/gateway-bot-realtime";

/** `"attachments_unsupported"` when `out` carries attachments, otherwise `undefined`. */
export function refuseAttachments(out: OutboundMessage): SendResult | undefined {
  return refuse(out, "clickclack");
}
