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

Additive. No existing export changes.
