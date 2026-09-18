---
"@theokit/gateway": minor
---

Add `toDialect(text, platform)` — markdown into the target channel's own dialect.

Measured across every `adapter.ts` and `split.ts` in the ten packages: no package transforms a
single character of text. What exists is markdown escape, HTML escape, phone normalisation and
post-cut newline cleanup. All ten READ `OutboundMessage.format`, but reading a flag is not
translating a body — so the agent answered `**Bom Sucesso (MG)**` and both LINE and WhatsApp
delivered the asterisks to a real phone.

The adapters refuse the translation deliberately and correctly: `gateway-whatsapp` reads `format`
only to warn once, because emphasis there is inline in the text rather than a transport flag. An
adapter is transport; translation depends on what was said AND where it is going, which makes it
presentation. It ships here as a pure function so the channel presenter in `theokit` can call it
without `@theokit/gateway` ever depending on `@theokit/presenter` (B-019 FR-005 / AC-004).

Taught three dialects — WhatsApp (`*bold*`, `_em_`, `~strike~`), LINE and SMS (markers dropped, no
rich text). A platform it has not been taught passes through UNCHANGED: inventing a mapping is
wrong invisibly, passing `**bold**` through is wrong where somebody can see it.
