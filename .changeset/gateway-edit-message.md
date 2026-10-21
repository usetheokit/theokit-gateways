---
"@theokit/gateway": minor
"@theokit/gateway-telegram": minor
"@theokit/gateway-discord": minor
"@theokit/gateway-slack": minor
"@theokit/gateway-mattermost": minor
"@theokit/gateway-matrix": minor
"@theokit/gateway-teams": minor
---

Edit a message an adapter sent, so a reply can stream as a preview that the final text replaces.

`BasePlatformAdapter` gains `supportsEdit` (`false` by default) and
`editMessage(messageId, out)`, whose default refuses with `edit_unsupported`, makes no platform
call and never throws. A third-party subclass that already declares a member with either name and
a different type no longer compiles against this release, and under `noImplicitOverride` one
that declares it without `override` does not either.

Telegram (`editMessageText`), Discord (one REST `PATCH` of the message, without fetching the
channel), Slack (`chat.update`), Mattermost (`patchPost`), Matrix (an `m.replace` event) and Teams
(`updateActivity`, or `activities(conversationId).update` on `@microsoft/teams.api` below 2.0.14)
set `supportsEdit` to `true` and replace the text of a message they sent, honouring `format` as
`sendMessage` does (Slack's `chat.update` takes no `mrkdwn` argument, so its edit sends the text
as it is for every format), and return `{ ok: true, messageId }` with the same id. E-mail, SMS, LINE and
WhatsApp keep the default.

An edit is refused with no request as `edit_too_long` when the text would need more than one
platform message (Matrix has no length check), as `invalid_message_id` for an empty id (and on
Telegram one that is not a safe positive integer), and as `empty_text` and `not_connected` where
`sendMessage` answers those. Telegram answers its "message is not modified" refusal as a success.
On Discord an unknown channel is answered by the platform, as `discord_10003`. On Matrix a
`#alias` the adapter never resolved costs one lookup before the edit. Teams and Matrix do not
retry a refused markup as plain text on an edit, as they do on a send.

The six adapters declare `editMessage` and `supportsEdit` with `override`, so typechecking these
adapters' sources against `@theokit/gateway` 0.9.0, the floor of their peer range, reports TS4113:
that core has neither member. The published declarations carry no `override`, so a consumer on
0.9.0 typechecks, and at run time the members work there, since no adapter calls the base
`editMessage`.
