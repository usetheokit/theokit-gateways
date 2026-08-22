---
"@theokit/gateway-whatsapp": minor
---

**A fail-closed sender allowlist.** The package had no sender filter at all. `shouldDropGroupMessage` fires only for *groups* with `requireMention`, so any stranger who sent a direct message reached the handler — and from there whatever agent is behind it.

That is two problems wearing one coat. A number that answers strangers accumulates blocks and reports, which is what WhatsApp's enforcement runs on, so an open gateway is a slow route to a banned number. And an agent wired to tools acts on what arrives, so an unfiltered inbound is an instruction channel for anyone who knows the number.

Pass `allowedSenders` to the adapter — a comma-separated list — and anything not on it is dropped and logged. `"*"` opens it, and has to be written deliberately.

**Absent and empty are different answers, on purpose.** No `allowedSenders` at all means the filter has not been adopted and delivery is unchanged; turning it on by default would mute every existing deployment, which is a breaking change and belongs to its own decision. An empty `allowedSenders` means someone configured a list and named nobody, and that is honoured: nobody gets through. The inverse default is a mistake worth naming — it makes the safest-looking configuration, the empty one, the most open.

An unidentifiable sender is refused even under the wildcard: `*` means "any sender", and something whose sender cannot be named is not a sender.

Identifier matching handles the shapes WhatsApp and humans actually produce — `5511999999999@s.whatsapp.net`, a `:12` device suffix, `+55 (11) 99999-9999`, and group JIDs. The device suffix is stripped before digits are taken; folding it in yields `551199999999912`, which matches nothing, so an allowlist would silently stop recognising a sender the moment they paired a second device.

Refusals are logged. A silent drop is indistinguishable from a broken gateway, and a mistyped allowlist otherwise presents as a bot that went mute for no reason.
