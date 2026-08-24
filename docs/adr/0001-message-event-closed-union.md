# ADR-0001 — `MessageEvent` is a closed discriminated union

- Status: **Superseded by [ADR-0002](0002-platform-event-registry.md)** (2026-08-23)
- Previous status: Accepted
- Date: 2026-07-10
- Deciders: gateway cluster maintainers
- Context source: `architect-output/ARCHITECTURE-REPORT.md` (coupling#4 / pattern#9), roadmap M3


> **Superseded, not refuted.** ADR-0002 reopened this decision because the revisit trigger below
> fired — out-of-repo adapters became a supported goal. The pricing recorded here was then measured
> and found substantially correct: adding a platform costs 4 lines of union machinery plus a 2-line
> exhaustiveness test, not more. The exhaustive-narrowing requirement this ADR defends is preserved
> by the successor, including over platforms the core has never heard of.

## Context and Problem Statement

`@theokit/gateway` defines `MessageEvent` (`packages/gateway/src/types/message-event.ts`)
as a **closed** discriminated union: all 10 platform event interfaces
(`TelegramMessageEvent`, `DiscordMessageEvent`, …) are declared in core and
folded into one union keyed by `platform`.

Because core is the most-depended-on module (Ca=10, instability I≈0.09), it
therefore carries structural knowledge of every platform. Adding an 11th
gateway means **editing the stable core union** rather than extending it purely
additively — a tension with the Open/Closed Principle. Should the union be
opened (e.g. a generic `MessageEvent<TPlatform, TExtra>` that new platforms
extend without touching core)?

## Decision

**Keep the union closed. Do not open it for OCP purity.**

The whole consumer ergonomics of the gateway rest on **exhaustive narrowing**:

```typescript
switch (event.platform) {
  case "telegram": return event.telegram.threadId; // narrowed
  case "discord":  return event.discord.guildId;   // narrowed
  // a missing case is a compile error via the `never` exhaustiveness check
}
```

`session/router.ts` (`defaultStrategy`) and every consumer `switch` rely on the
compiler proving all platforms are handled. Opening the union would trade this
**compile-time exhaustiveness** for **runtime uncertainty** — the exact
property a curated, first-party set of adapters should not give up.

## Consequences

- **Positive:** consumers get exhaustive, compiler-checked narrowing; a new
  platform cannot be half-wired (the `never` check fails the build until every
  `switch` handles it).
- **Negative (accepted):** adding a gateway is a bounded, compiler-guarded
  ~3-line edit to the core union (add the `PlatformName` literal + the variant
  interface + fold it in). This is a *modification*, not a pure *extension*.
- **Revisit trigger:** if third-party / out-of-repo adapters ever become a
  supported goal (today all 11 packages are first-party, in-repo), reopen this
  decision — an open/generic union would then be worth its runtime-uncertainty
  cost. Until then, closed wins.

## Alternatives considered

1. **Generic open union (`MessageEvent<P, X>`)** — rejected: defeats exhaustive
   narrowing; every consumer would need runtime platform guards.
2. **Registry of event shapes resolved at runtime** — rejected: moves a
   compile-time guarantee to runtime for no first-party benefit (YAGNI).
