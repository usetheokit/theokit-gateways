---
"@theokit/gateway": minor
"@theokit/gateway-telegram": minor
"@theokit/gateway-discord": patch
"@theokit/gateway-email": patch
"@theokit/gateway-line": patch
"@theokit/gateway-matrix": patch
"@theokit/gateway-mattermost": patch
"@theokit/gateway-slack": patch
"@theokit/gateway-sms": patch
"@theokit/gateway-teams": patch
"@theokit/gateway-whatsapp": patch
---

Send an image from a gateway handler, and refuse it wherever a platform cannot show one.

`@theokit/gateway` exports `OutboundAttachment` (`kind: "image"`, `mediaType`, `data`, optional
`filename`). `OutboundMessage` gains an optional `attachments` list, `ctx.reply(text, { attachments })`
carries it to the adapter (an empty list is left out), and `BasePlatformAdapter` declares
`supportsAttachments`, `false` by default. `DeliveryRouter.send` takes the same `attachments`
field. The runner and the router refuse an outbound carrying attachments as
`attachments_unsupported`, with no `sendMessage` call, when the adapter does not declare
`supportsAttachments`.

`@theokit/gateway-telegram` reports `supportsAttachments: true` and sends each image through
`sendPhoto`, the text as the first photo's caption up to 1024 UTF-16 units and after the photos
when longer. A non-image kind is refused as `attachments_unsupported`; a missing image, more
than 10 images or an image over 10 MiB as `invalid_attachment`; all with no request.

Every other adapter, and every adapter's `editMessage`, refuses an outbound carrying attachments
with `attachments_unsupported` and makes no platform call, instead of sending the text and
dropping the image.
