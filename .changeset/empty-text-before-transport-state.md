---
"@theokit/gateway-slack": patch
"@theokit/gateway": patch
---

**Slack now answers `empty_text` for empty text, like the other nine adapters.** The contract states it without a condition — `sendMessage` with empty text returns `{ ok: false, code: "empty_text" }` — but Slack checked the connection first, so the same call answered `not_connected` there and `empty_text` everywhere else.

Nobody lost a delivery over it: both results are already `ok: false`. What broke is code that branches on the code — treating a caller's bad input one way and an unavailable transport another, with a retry or an alert behind the second. Written against the contract, that code did the right thing on nine platforms and the wrong thing on the tenth, with nothing to say why.

The connection guard keeps its reason (`this.app` is set before `app.start()` resolves, so a send in that window would otherwise leak through); only the order changed. Input first, transport second, which is what `rules/error-handling.md` § 2 asks for and what the other nine already did.

The cross-adapter gate gains the invariant, and it is checked against a deliberately reverted adapter. That check earned its keep immediately: the first version of the invariant read a window of raw source that its own explanatory comment filled, so it passed against the reverted adapter by matching the prose describing the rule. It now strips comments before asking — a gate answered by a comment is worse than no gate, because it reports coverage it does not have.
