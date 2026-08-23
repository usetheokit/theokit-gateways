---
"@theokit/gateway-whatsapp": minor
---

**Meta's `131030` gets its own error code: `recipient_not_allowlisted`.** It used to collapse into the generic `invalid_request`, which sends a developer to re-read a payload that was correct. The remedy is a console step — register the recipient against the phone number — and it travels with the message now, exactly as `session_window_expired` already does for `131047`.

This is the error most Cloud API integrations meet first. Every app starts on a free test number whose recipients must be registered one at a time, so it is both the commonest failure and the one where a wrong diagnosis costs the most: the request is fine, so nothing in it explains the refusal.

**This widens `WhatsAppSendResult["error"]["code"]`**, so an exhaustive `switch` over it stops compiling until the new case is handled. No call site in this repository switches on it.

The WhatsApp live suite now distinguishes the two, and does so without giving itself a hiding place. An unregistered recipient is incomplete configuration — the same category as a missing credential, which this suite already skips whole platforms for — so it skips, naming the number and the console step. But a recipient *we* mangled would be refused identically, so the skip is only reached after asserting that the recipient which actually left the process, captured through the `fetch` seam, is the one configured.

That guard took two attempts. The first compared `digitsOnly(configured)` against `configured` — which reads as a check on our own bytes and is not one, because `digitsOnly` is not on the send path at all. It asserted that the env var contains digits, and was satisfied unconditionally. A reviewer substituted the adapter's own `botPhoneId` for the recipient — a one-token regression, one line away in the same class — and watched a total outbound-routing failure skip as a provisioning gap. The current guard fails that mutation, which was verified by performing it.
