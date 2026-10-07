---
"@theokit/gateway-teams": patch
---

A `key_set_unavailable` refusal from `teamsActivityVerifier` now says which key set failed, at
which URL, and why its latest read failed: the HTTP status, no answer within 10 s, the network
error code (for example `ECONNREFUSED`), or a document that is too large, is not JSON, has no
`keys` array or lists too many keys. Before, every cause gave the same message, so a blocked
egress, a wrong URL and a Microsoft outage could not be told apart. The reason itself is unchanged.
