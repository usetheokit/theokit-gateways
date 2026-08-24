---
"@theokit/gateway": patch
"@theokit/gateway-telegram": patch
"@theokit/gateway-sms": patch
---

The seam between the three repositories is documented, and the reason given for one contract was corrected.

`@theokit/gateway`'s README — the npm page — now says which repository owns which half: TheoKit the
HTTP route and the signature check, these packages the translation of the payload it hands over, the
SDK one redaction helper. A `quality:integration-story` gate fails when that disappears and passes
when the prose is rewritten around the same facts.

Both adapters' published docblocks stated that a TheoKit app's `onMessage` runs AFTER the 200 is
answered, so a throw there had no status left to change. Measured against `theokit@0.48.14`,
`handleChannelWebhook` awaits `onMessage` BEFORE building the response and catches nothing around
it: a throw means the 200 is never built, and mounted in a TheoKit route the rejection reaches that
route's error boundary and is answered 500 where the platform expected an acknowledgement. `parseInbound` returning `null`
is unchanged and still the right contract — only the stated reason was wrong, and it was reaching
users through the `.d.ts` on hover.

`@theokit/gateway-sms`'s docblocks also named the wrong seam. Its `parseInbound` is
`(options, ctx)`, and the `SignatureContext` it needs carries the raw body, the headers and the URL
— none of which TheoKit's `ChannelMessage` provides, so the signature check cannot be performed
from inside `onMessage` for any provider. SMS goes through its own `createWebhookServer`, and the
published `.d.ts` says so now instead of claiming to be the gateway half of the channel seam.
