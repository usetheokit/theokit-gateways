---
"@theokit/gateway-whatsapp": patch
---

Five findings from an independent review of the credential-check and conformance work, all closed:

- **`verifyCredentials()` threw on a `null` body.** `response.json()` resolves `null` for the JSON literal, which is neither `undefined` nor an object, so the guard let it through and the next line dereferenced it — and the throw escaped `connect()` unwrapped. That is precisely the clause this series exists to defend: a throw at startup takes the host down with it. Arrays, strings and numbers were equally unguarded and now are.
- **`sendTemplate()` still posted an unverified credential.** The guard went on `send()` and stopped there. Being off the `WhatsAppBackend` interface — WhatsApp Web has no templates — is why the conformance suite structurally cannot see this method, which is a reason it needs its own guard, not a reason to be exempt from the rule.
- **The conformance suite asserted three of the five clauses it was written to enforce.** `connect()` idempotency and its failure contract were unasserted, which is exactly why the `null`-body throw above was invisible to the suite added to catch that class. Both are covered now — and writing them exposed that the contract itself was wrong: it demanded `false` absolutely, and two backends "failed" by throwing on a missing browser and a missing peer. They were right. **Misconfiguration throws; operational failure returns `false`**, and the interface says so.
- **The `web` conformance row observed nothing.** It carried `reachedNetwork: undefined` and a comment naming the elapsed-time check as its coverage — which a reviewer disproved by mutation, in about a millisecond. It uses the backend's documented `spawnFactory` seam now, so the row counts spawns like the others, and stops writing `.wwebjs_auth` into the package as a side effect.
- **A numeric `id` produced a refusal that contradicted itself**: *"resolves to node 12345, not the configured phoneNumberId 12345"*. Compared as strings.
