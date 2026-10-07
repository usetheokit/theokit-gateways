---
"@theokit/gateway-teams": patch
---

A key-set document that lists no usable RSA key (an empty `keys` array, or only entries whose key
material is refused or is not RSA) is now a failed read. Before, it counted as a successful read
and replaced the copy held, so for the next 10 seconds every genuine token was refused as
`invalid_token`, which a route answers with a non-retryable 4xx. Now the last good copy is kept,
and with no copy the refusal is `key_set_unavailable`, whose message says the document lists no
usable RSA key.
