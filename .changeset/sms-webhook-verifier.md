---
"@theokit/gateway-sms": minor
---

`smsWebhookVerifier(adapter)` — serve an SMS webhook through a framework channel seam.

A webhook seam takes a map of validators, and there was no way to put SMS in one. Twilio signs the
URL plus the sorted POST parameters, Plivo signs a different string, and Vonage uses a JWT — three
schemes that already live in this package with their own tests. Reimplementing them in the
framework would put security-critical code in two repositories and guarantee they drift, so the
direction is inverted: the framework declares the shape, and the package that owns the platform
provides the implementation.

```ts
await handleChannelWebhook(request, pathname, {
  validators: { sms: smsWebhookVerifier(adapter) },
})
```

Nothing new is depended on. The return type is structural, declared here as `WebhookVerifyResult`.

**`SMSAdapter.publicUrl` is now public, and now does something.** All three backend option shapes
require it and document it as "used by signature verifier" — and no source file read it: it appeared
only in the type and in test fixtures. Twilio SIGNS that URL, so it matters most in exactly the case
the request cannot cover: behind a proxy or a tunnel, the request's own URL is the internal one and
will not match what was signed. The verifier uses it.

One behaviour worth knowing before wiring this: **connect the adapter first.** Each backend loads
its provider SDK during `connect()`, and until then `verifySignature` answers `false` for
everything — so a verifier wired earlier refuses every genuine delivery as a bad signature. The two
are not distinguishable through the backend contract, which returns a boolean; the behaviour is
pinned by a test rather than papered over.
