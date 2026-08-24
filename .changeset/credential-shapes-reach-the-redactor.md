---
"@theokit/gateway": minor
---

The redactor covers this domain's credentials, and says which it does not.

`Security.redact` ships patterns for AI and cloud provider keys. Measured across the sixteen
credential fields these ten adapters declare, it masked one: Slack's `xoxb-`, which is one of its
built-ins. On a Telegram token it was worse than absent — a token is `<bot_id>:<secret>`, the numeric
prefix is the bot's PUBLIC user id, and the SDK's `key=value` matcher stops at the colon, so
`token=8123456789:AAF…` came out as `token=***:AAF…`.

Six shapes with a distinctive structure — Telegram, Discord, Slack's app token, Matrix, WhatsApp,
Teams — are now replaced entirely before the text reaches the SDK. Entirely rather than the SDK's
`first6…last4`, because the six leading characters of a token identify the account it belongs to.

Ten fields are recorded as deliberately uncovered, each with its reason. 32 lowercase hex is also an
md5 digest and a dashless UUID; 26 lowercase alphanumerics is a ULID; a passphrase is
indistinguishable from prose. A pattern wide enough to catch those eats the correlation ids and
trace ids a developer reads an error log to find, and losing one costs a debugging session.

`redactSecrets` masks locally rather than registering with `Security.addPattern`. Registering did two
things wrong: the SDK applies extra patterns before its own `key=value` rule, so claiming a value
there DOWNGRADED `password=***` to `password=hunter…aple`; and it mutates module state inside the
SDK, so an app importing this package inherited these shapes in its own unrelated redaction.

New exports: `redactSecrets`, `maskShapes`, `CREDENTIAL_SHAPES`.
