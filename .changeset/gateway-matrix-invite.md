---
"@theokit/gateway-matrix": minor
---

Join room and DM invites. A new `acceptInvite(inviter, roomId)` option decides which invites the
bot joins, both live ones and those pending at start; without it nothing is joined, so a stranger
cannot pull the bot into a room.
