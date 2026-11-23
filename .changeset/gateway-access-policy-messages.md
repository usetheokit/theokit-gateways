---
"@theokit/gateway": minor
---

`createAccessPolicyHook` takes an optional `messages` option (`pairingCode`, `invalidCode`, `failedSave`, `paired`, `pairingOff`) so an app can keep its own reply texts. Each entry defaults to the current wording.
