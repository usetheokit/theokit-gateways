---
"@theokit/gateway": minor
---

A gateway can now be authored, published and consumed outside this repository.

`PlatformName` and `MessageEvent` derive from a new exported `PlatformEventRegistry`, an interface
other packages extend through TypeScript declaration merging:

```ts
declare module "@theokit/gateway" {
  interface PlatformEventRegistry {
    signal: SignalMessageEvent;
  }
}
```

Exhaustive narrowing survives, including over platforms the core has never heard of: forget a
`case` for a third-party platform and the build breaks, exactly as it does for the ten shipped
here. A misspelled platform name is still a compile error — the union is opened to extension, not
to arbitrary strings.

Both sides of an augmentation are gated. An entry typed `any`, registered under an index signature,
carrying a non-literal discriminator, or disagreeing with its own key is excluded rather than
admitted. Each of those was measured to break narrowing for **every** consumer before the guards
existed — an index signature made the whole union resolve to `never`, and an optional entry injected
`undefined` into it. Twelve augmentation shapes are compiled in CI against the published
declaration to keep it that way.

**Behaviour change:** `BaseMessageEvent.platform` is now `string` rather than `PlatformName`. Every
concrete variant still narrows it to its own literal, so code holding a `MessageEvent` is
unaffected. Code that assigns `.platform` off a bare `BaseMessageEvent` into a `PlatformName` slot
will need a narrowing step. This is required by the derivation: `PlatformName` now comes from the
guarded union, and naming it on the base would make the two reference each other.

See `docs/adr/0002-platform-event-registry.md`, which supersedes `docs/adr/0001-message-event-closed-union.md`.
