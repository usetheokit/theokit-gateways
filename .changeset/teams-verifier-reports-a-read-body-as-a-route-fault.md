---
"@theokit/gateway-teams": patch
---

`teamsActivityVerifier` refuses a request whose body was already read, or is locked by another
reader, as `body_already_read`, with a message saying the body was already read and to pass an
unread request such as `request.clone()`. It is the route's fault, not the sender's and not the
validator's, and no retry clears it, so the README route answers it with a 500. A body that fails
part-way through the read, and a POST with no body, are `malformed_body`.
