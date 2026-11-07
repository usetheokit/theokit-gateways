---
"@theokit/gateway-google-chat": patch
"@theokit/gateway-imessage": patch
"@theokit/gateway-irc": patch
"@theokit/gateway-nextcloud-talk": patch
"@theokit/gateway-signal": patch
---

Refuse an outbound that carries images with `attachments_unsupported`, making no platform call,
instead of sending its text and dropping the images. The same refusal answers an outbound with
attachments on every adapter that sends text only.
