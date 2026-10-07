---
"@theokit/gateway-teams": minor
---

`teamsActivityVerifier` refuses an activity whose `channelId` is absent or is not `msteams`, with
the new reason `channel_mismatch`, even when its token passes every check. A connector token is
issued for the bot, not for one channel, so a genuine token also arrives with activities from the
bot's Web Chat and Direct Line channels, where the client, not Microsoft, sets `from` and
`channelData`; the verifier used to accept them as Teams activities. `channel_mismatch` is a client
fault: answer it with a 4xx, not a 503. The Azure portal's "Test in Web Chat" and the Bot Framework
Emulator are refused the same way. Code that switches exhaustively on `TeamsActivityVerifyResult`
reasons gains one case.
