---
"@theokit/gateway-email": minor
---

The nodemailer peer range no longer admits only vulnerable versions.

`nodemailer ^8.0.0` was declared as a peer, and the whole of `^8` is inside the range an advisory
names vulnerable (`<=9.0.0`, "Message-level raw option bypasses disableFileAccess/disableUrlAccess").
A consumer following our range got a vulnerable nodemailer; one who wanted a safe one got a peer
conflict.

The peer is now `^9.0.1`. Nodemailer 9 keeps `createTransport`, `sendMail`, `verify` and `close` —
the entire surface this adapter uses — and its 95 tests pass against it.

The advisory's subject is a message-level `raw` option on send, which this adapter does not use; it
parses inbound mail. The range moved anyway: one that admits only vulnerable versions is a defect
whether or not the vulnerable path is reachable.
