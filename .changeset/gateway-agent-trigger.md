---
"@theokit/gateway-agent": minor
---

Add `createTrigger`, which runs an agent on a signed webhook and posts the answer to a channel (401 on a bad signature, 400 for an oversized delivery id, 503 while the reply adapter is down, 200 for a repeated id, 202 while the run goes on in the background), and `frameUntrusted`, which wraps untrusted text in a tag with a forged closing tag escaped.
