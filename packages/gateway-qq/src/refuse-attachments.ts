/**
 * Refuses an outbound that carries attachments: this adapter sends text only (B-674). Local to the
 * package so the adapter calls nothing its declared core floor lacks.
 */

import type { OutboundMessage, SendResult } from "@theokit/gateway";

/** `attachments_unsupported` when `out` carries attachments (`!== 0`, so a non-array is refused too). */
export function refuseAttachments(out: OutboundMessage): SendResult | undefined {
  if (out.attachments == null || out.attachments.length === 0) return undefined;
  const message = "qq adapter cannot send attachments";
  return { ok: false, error: { code: "attachments_unsupported", message } };
}
