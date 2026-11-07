---
"@theokit/gateway-whatsapp": minor
---

`WhatsAppCloudBackend.handleWebhookPayload` now resolves `"unreadable_body"` (not `false`) for a
signed body that is not JSON or that `parseWebhookPayload` refuses, so a route can answer it
differently from a bad signature (`false`, 401). The return type widens from `boolean` to
`boolean | "unreadable_body"`; the package is 0.x, so this is a minor bump. A route that tested
`!ok` and answered 401 now answers 200 for such a body, which stops Meta's useless redeliveries.
