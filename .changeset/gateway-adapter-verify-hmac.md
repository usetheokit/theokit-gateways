---
"@theokit/gateway-line": patch
"@theokit/gateway-whatsapp": patch
"@theokit/gateway-nextcloud-talk": patch
"@theokit/gateway-yuanbao": patch
---

Verify webhook signatures with the core `verifyHmac`, and compare the WhatsApp verify token with `safeEqualString`; an empty expected verify token now never matches. Raises the `@theokit/gateway` peer floor to 0.26.0.
