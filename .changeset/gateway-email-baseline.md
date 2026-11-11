---
"@theokit/gateway-email": minor
---

The first connect no longer dispatches the unread backlog. It records the mailbox's UIDNEXT (with its UIDVALIDITY) as a cursor and dispatches only mail that arrives after it; `connect()` resolves once the baseline is set. A new `cursorStore` option persists the cursor across restarts; a changed UIDVALIDITY resets it.
