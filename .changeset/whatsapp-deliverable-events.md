---
"@theokit/gateway-whatsapp": minor
---

Add `WhatsAppAdapter.toDeliverableEvents(envelope)` and `WhatsAppAdapter.toDeliverableEvent(inbound)`,
and export the `MetaWebhookEnvelope` type from the package entry.

An application that hosts its own WhatsApp Cloud webhook route could parse Meta's envelope, but had
no public way to turn it into the event `deliver()` accepts with the adapter's sender allowlist and
group-mention rule applied: the conversion was private and the rules ran only inside `onInbound`. A
route that copied the private conversion would have admitted every sender the operator refused.
`toDeliverableEvents` returns the accepted events of an envelope in order, and `onInbound` now
decides through `toDeliverableEvent`, so both paths apply one rule set and write the same refusal
line. Neither method calls the backend or the network, and neither verifies the webhook signature;
the route still does that first. The README's "How inbound arrives" shows the route end to end.

Two behaviours change on every inbound path, `onInbound` included. An adapter built with
`fromCloud` drops a message addressed to another `phone_number_id`, naming that id on stderr once,
because one Meta app signs every number's webhooks with the same secret. The allowlist refusal line
names the sender by the last four digits of the number only (`a sender ending in 8888`), where it
used to print the whole number. `toDeliverableEvents` throws `ConfigurationError`
(`missing_phone_number_id`) when the adapter's backend declares no `phoneNumberId`, so a backend
that wraps `WhatsAppCloudBackend` must expose the field instead of silently receiving every
number's messages.

No existing export changes.
