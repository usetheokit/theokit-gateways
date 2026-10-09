---
"@theokit/gateway-whatsapp": patch
---

`WhatsAppBackend` gains an optional `phoneNumberId`, the Meta Cloud phone number id the backend
answers for. `WhatsAppAdapter` now reads that field to decide whether a message is addressed to
another number of the same Meta app, instead of checking whether the backend is an instance of
`WhatsAppCloudBackend`. Before, a wrapped Cloud backend, a test double, or a `WhatsAppCloudBackend`
loaded from the package's other module format (ESM beside CJS) lost the check without a word, and
another number's messages reached the agent. A custom backend that declares `phoneNumberId` now
gets the same check; one that declares none behaves as before.
