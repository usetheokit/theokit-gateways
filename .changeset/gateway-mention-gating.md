---
"@theokit/gateway-discord": minor
"@theokit/gateway-matrix": minor
"@theokit/gateway-teams": minor
"@theokit/gateway-line": patch
---

Group messages that do not mention the bot are no longer delivered by default on Discord, Matrix
and Teams; pass `requireMention: false` to keep the old behaviour.

Discord, Matrix and Teams gain a `requireMention` option that defaults to `true`. With it on, a
group or thread message reaches the handler only when it mentions the bot, and a DM always does.
Discord reads the bot's id in `mentions.users` (a direct mention or a reply that pings it; not
`@everyone`, `@here` or roles), and drops group messages with one stderr line until the client is
ready. Matrix reads `m.mentions.user_ids`, and falls back to the full user id in `body` or
`formatted_body` when a client sends no `m.mentions`. Teams reads `mention` entities against the
activity's `recipient.id`, and drops a group activity that names no recipient with one stderr line.

LINE's `deliver()` now applies the mention guard its webhook route already applied.

On all four adapters `deliver()` and the adapter's own inbound path use one rule, and `deliver()`
answers `"ok"` for an event the rule drops, with or without a handler subscribed.
