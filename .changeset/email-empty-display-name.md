---
"@theokit/gateway-email": patch
---

An email with no display name no longer carries an empty one.

`mailparser` reports `name: ""` for a bare `From: alice@example.com` — not `undefined` — and the
guard tested only for `undefined`. So every message without a display name arrived with
`email.fromName: ""` and `sender.displayName: ""` present rather than absent, which is a different
shape from the one the optional fields promise: a consumer testing `"displayName" in sender` saw a
name that was not there.

The convention two lines further down in the same function is already `addr.length > 0`.

Found by mutation testing: eight mutants of the two conditional spreads survived, because no test
read either field.
