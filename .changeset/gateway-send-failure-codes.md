---
"@theokit/gateway-x": minor
"@theokit/gateway-qq": minor
"@theokit/gateway-zalo": minor
"@theokit/gateway-yuanbao": minor
---

Send failures use the shared `SendErrorCode` values instead of `x_send_failed`, `qq_send_failed`, `zalo_send_failed` and `yuanbao_send_failed`. An HTTP failure maps by status through `sendErrorFromHttp` (429 is `rate_limit` with `retryAfterMs` from `Retry-After`, 401 is `auth_failed`, and so on); a 200 answer with a platform error code is `platform_error` with that code in `platformCode`; a rejected fetch is `network_error`. The fetch seam's response may now carry optional `headers`. The `@theokit/gateway` peer floor is now `>=0.26.0`.
