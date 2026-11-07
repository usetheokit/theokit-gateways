---
"@theokit/gateway-whatsapp": minor
---

`WhatsAppCloudBackend.handleWebhookPayload` now resolves to a `WebhookOutcome` string
(`"accepted"`, `"bad_signature"`, `"unreadable_body"` or `"no_handler"`) instead of a boolean, so a
route can answer a forged signature (401) differently from a signed body the parser refuses (200,
since Meta's redelivery of the same bytes is refused again). `WebhookOutcome` is exported.

Breaking for callers that test the result for truthiness: every string is truthy. Compare with
`=== "accepted"`. The package is below 1.0, so this is a minor bump.
