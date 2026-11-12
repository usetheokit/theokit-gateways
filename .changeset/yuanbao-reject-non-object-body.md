---
"@theokit/gateway-yuanbao": patch
---

`handleWebhook` answers 400 to a signed body that is valid JSON but not an object (`null`, a number, a string, an array, a boolean) instead of throwing.
