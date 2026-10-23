---
"@theokit/gateway-imessage": minor
---

Add `@theokit/gateway-imessage`, an iMessage adapter.

`@theokit/gateway-imessage` (first release) exports `IMessageAdapter`, which starts `imsg rpc` and
talks to it over stdio. `connect()` returns `true` only once `imsg` accepts `watch.subscribe`, and
`false` when the binary is missing, `imsg` refuses, or no answer arrives within
`connectTimeoutMs`. Messages the signed-in account sent, the adapter's own replies included, never
reach the handler. When `imsg` exits and the adapter reconnects, it resumes after the last row its
handler finished; that cursor lives in memory and does not survive a new adapter instance or
process. `channel.id` is `imsg`'s numeric chat id, and anything else is refused with
`invalid_chat_id`. Send errors keep `imsg`'s meaning and are never retried:
`imsg_outcome_uncertain` (the message may have been sent), `imsg_not_sent` (safe to retry),
`imsg_send_lane_blocked` (the adapter ends the child; connect again) and `imsg_error` for the
rest. The package has no runtime dependencies
and requires `@theokit/gateway` 0.12.0 or later, the first version with the `imessage` key. `imsg`
on a Mac signed in to Messages is the operator's to provide.
