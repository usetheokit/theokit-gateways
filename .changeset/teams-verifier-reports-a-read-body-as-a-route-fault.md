---
"@theokit/gateway-teams": patch
---

`teamsActivityVerifier` now refuses a request whose body was already read, or is locked by another
reader, as `validator_unavailable`, with a message saying the body was already read and to pass an
unread request such as `request.clone()`. Before, it was `malformed_body`, so a route whose
framework consumed the body first answered every Teams request with a 400 that blamed the sender.
A body that fails part-way through the read is still `malformed_body`. The reason union is
unchanged.
