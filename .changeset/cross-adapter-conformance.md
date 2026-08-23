---
"@theokit/gateway": patch
---

**A behavioural conformance suite now runs the `PlatformAdapter` contract against all nine credential-based adapters at once**, in `integration/tests/unit/`. It needs no credential and no network — every assertion is about what an adapter does *before* it connects, because a conformance suite that needs provisioning is a conformance suite that does not run.

The existing cross-adapter gate reads source text, which is the right tool for what it catches and the wrong one for this. Getting that file honest took five attempts in this repository, four of which passed while checking nothing: a regex matching zero declarations, a window reaching into the neighbouring method and accepting its guard, a brace matcher fooled by a string literal, a floor that only fired when the count dropped. Each was a statement about text that read like a statement about behaviour.

What the new suite asserts, per adapter: it declares the platform it is (the routing key — an adapter naming itself wrong is silently unreachable rather than broken); `disconnect()` on one that never connected resolves rather than throwing, and again on a second call; and the unsubscribe `onInbound` returns is safe to call twice. All nine conform today, verified by mutation — a wrong `platform`, a throwing `disconnect()`, and an `off()` that throws on reuse each fail it.

One invariant is **deliberately absent and says so in the file**: "a stale unsubscribe does not deafen a live subscription". It was written, it passed, and mutation showed it could not fail — the only assertion available without a connection is that `onInbound` returns a function, which holds either way. It stays covered textually for all ten and behaviourally for WhatsApp, whose adapter takes a backend and therefore has a dispatch seam. A file arguing that behaviour beats text should not make the argument with an assertion that cannot fail.
