---
"@theokit/gateway-whatsapp": minor
---

**The Cloud API error mapper now recognises the codes Meta actually sends.** It recognised none of them.

`cloudErrorCode` tested `errCode === 130 || errCode === 131`. No Cloud API response can satisfy that — the codes in those families are six digits (`130429`, `131047`, `131026`, `130403`). Someone truncated the prefixes, the rate-limit branch became dead code, and every real throttle reached the caller as `invalid_request`. A consumer with backoff behind `code === "rate_limit"` never saw it fire, and kept calling an API that was throttling it.

The unit test that claimed to cover this passed a fabricated code `130` and asserted `rate_limit` — which it got from the HTTP 429 in the same call, not from the code. It proved the mapper agreed with whoever wrote the test. Every code in the suite is now one Meta publishes, with the number stated in the test.

**Two new codes, because collapsing them threw away the answer.**

`session_window_expired` (`131047`) — more than 24 hours since the recipient last replied. The credential is valid and the payload is correct; WhatsApp policy refuses free-form text outside that window, and Meta's own remedy is to resend as an approved template. Reported as `invalid_request`, that instruction was indistinguishable from "your JSON is wrong". The message now carries the remedy too.

`undeliverable` (`131026`, `130403`) — the recipient has no WhatsApp account, has not accepted the terms, is on an outdated client, or has been blocked by the business. Terminal: no retry changes it, which is the opposite of what `invalid_request` suggests.

Rate limiting now covers `4` (app), `80007` (business account) and `130429` (Cloud API throughput), alongside the HTTP 429 that was doing all the work.

Minor rather than patch: `WhatsAppSendResult["error"]["code"]` gains two members, so an exhaustive `switch` over it stops compiling until the new cases are handled. That is the intended prompt — the two conditions were always reachable, and were being silently mislabelled.
