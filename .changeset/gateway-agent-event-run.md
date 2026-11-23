---
"@theokit/gateway-agent": minor
---

New `createEventRun`: run an agent with no tools on an event that did not arrive over HTTP, frame the body with `frameUntrusted`, and deliver the summary to a chat. `createTrigger` now uses it.
