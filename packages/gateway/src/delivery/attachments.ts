/**
 * How the core's two outbound builders treat `attachments` (B-674): `GatewayRunner`'s `ctx.reply`
 * and `DeliveryRouter.send` both carry a non-empty list and both refuse it for an adapter that
 * does not declare `supportsAttachments`.
 *
 * The refusal here is defence in depth: every adapter in this repository refuses on its own, but an
 * adapter written elsewhere inherits `supportsAttachments = false` and may ignore the field, sending
 * the text alone and reporting success. Refusing before the adapter is called keeps the image from
 * being dropped in silence whichever adapter receives it.
 *
 * @internal
 */

import type {
  BasePlatformAdapter,
  OutboundAttachment,
  OutboundMessage,
  SendResult,
} from "../adapter/base.js";

/**
 * The non-empty `attachments` of a request, or nothing for absent, `null` or empty. `!== 0`, not
 * `> 0`: another non-array value from a JavaScript caller has no numeric length and is carried on,
 * to be refused, rather than dropped (EC-1).
 */
export function attachmentsOf(attachments: ReadonlyArray<OutboundAttachment> | undefined): {
  attachments?: ReadonlyArray<OutboundAttachment>;
} {
  return attachments != null && attachments.length !== 0 ? { attachments } : {};
}

/**
 * `attachments_unsupported` when `outbound` carries attachments and `adapter` does not declare
 * `supportsAttachments`, otherwise `undefined`. Makes no platform call.
 */
export function refuseUnsupportedAttachments(
  adapter: BasePlatformAdapter,
  outbound: OutboundMessage,
): SendResult | undefined {
  const { attachments } = outbound;
  if (adapter.supportsAttachments || attachments == null || attachments.length === 0) {
    return undefined;
  }
  return {
    ok: false,
    error: {
      code: "attachments_unsupported",
      message: `${adapter.platform} adapter cannot send attachments`,
    },
  };
}
