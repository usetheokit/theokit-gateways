---
"@theokit/gateway-whatsapp": minor
---

**`WhatsAppAdapter.fromCloud()` and `.fromWeb()` now exist.** The class docblock has instructed consumers to call them since the package was written, and neither did. Three exported types described that API — `WhatsAppAdapterOptions`, `WhatsAppCloudConfig`, `WhatsAppWebConfig` — and no source file consumed any of them. Anyone following the only construction guidance the package gave wrote code that did not compile.

The factories build the backend and delegate to the constructor, so a consumer stops importing `WhatsAppCloudBackend` to pass it in. The constructor stays for tests and for a backend of your own.

They also validate — `accessToken`, `phoneNumberId`, `sessionId`, and `apiVersion` when it is supplied. Deliberately **not** `appSecret`: it verifies inbound webhook signatures and outbound never reads it, so requiring it would lock an outbound-only consumer out of the path the factory exists to offer. This repository's own integration suite passes `""` for exactly that reason. `fromCloud` with an empty `accessToken` now throws `ConfigurationError` at construction rather than returning an adapter that fails later against the network — a factory that hands back something which cannot authenticate has moved the error away from its cause, so the stack names a send when the mistake was in construction. `ConfigurationError` extends the core's `GatewayConfigurationError` and carries this package's prefix, so one `catch (e) { if (e instanceof GatewayConfigurationError) }` works across the adapters that use it. Counted rather than assumed: four of the nine siblings do — line, matrix, mattermost and sms. The other five (discord, email, slack, teams, telegram) do not reference the base at all, so this is a convergence toward a shared base and not yet a property of the whole family.

`WhatsAppAdapter.from(options)` is the entry point for configuration that arrives as **data** — read from a file, an environment or a tenant record — where the backend is a string rather than a decision made in code. It is what `WhatsAppAdapterOptions` exists for, and until it had that consumer the union was exported, documented and inert, which is the defect #47 was filed about.

`WhatsAppAdapterOptions` was reshaped: the union now carries only what differs between backends. `requireMention`, `botPhoneId` and `allowedSenders` mean the same thing on either one and moved to `WhatsAppAdapterCommonOptions`, so there is one copy rather than one per arm for the two to drift apart. Nothing consumed the type before, so no caller can break.

Worth naming why the alternative was rejected: deleting the promise and documenting the real constructor was cheaper and equally honest, and it was the front-runner until a third backend became concrete. With three, picking one by a string discriminator is the ergonomics the union was written for.

`quality:doc-coverage` read 100% throughout, because it measures whether a docblock exists and not whether it is true.

**A misconfiguration that used to be silent now says so.** `requireMention` defaults on and `botPhoneId` has nothing to default from on the web backend, so a web adapter built without one dropped every group message and explained nothing — the adapter cannot tell whether it was mentioned. The drop is now logged, matching the sibling allowlist check fifteen lines below it, whose own comment says a silent drop is indistinguishable from a broken gateway.

**Known cost, measured.** `fromWeb` holds a static reference to `WhatsAppWebBackend`, so a bundler can no longer drop the web backend from a cloud-only consumer's build: an esbuild bundle of `import { WhatsAppAdapter }` alone grows from 6,565 to 33,780 bytes. No new runtime dependency is pulled — `whatsapp-web.js` is still only `import()`ed inside the spawned bridge, never at import time. Accepted rather than fixed: this package targets Node, where that size is not a user-facing cost, and the alternative is an async factory, which is a worse API for every consumer in order to serve bundle size for some.
