---
"@theokit/gateway": minor
---

Add `createAccessPolicyHook`, `createFilePairingStore` and `senderKey`: a `pre_inbound` hook that lets owners, paired and allowlisted senders through on platforms that authenticate the sender, applies a DM policy (`pairing`, `allowlist`, `open`, `disabled`) to strangers, and rate limits refusals.
