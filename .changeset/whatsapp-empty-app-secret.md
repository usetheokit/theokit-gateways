---
"@theokit/gateway-whatsapp": patch
---

`verifyWebhookSignature` now throws `ConfigurationError` with code `missing_option` when the app
secret is empty or whitespace only, instead of checking the signature against it. Anyone can
compute an HMAC under an empty key, so a webhook route built on an outbound-only adapter
(`appSecret: ""`) accepted forged envelopes, and a forged envelope can name any allowed sender.
`WhatsAppCloudBackend.handleWebhookPayload` goes through the same check and now rejects in that
case. `fromCloud` still accepts an empty `appSecret` for an adapter that only sends. The README
route now says the secret must be non-empty.
