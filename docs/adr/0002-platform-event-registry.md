# ADR-0002 — `MessageEvent` derives from an augmentable platform registry

- Status: Proposed
- Date: 2026-08-23
- Deciders: gateway cluster maintainers
- Supersedes: [ADR-0001](0001-message-event-closed-union.md)
- Evidence: `.claude/knowledge-base/discoveries/opportunities/gateway-open-platform-registry-opportunity.md` (B-008)

## Context and Problem Statement

ADR-0001 closed `MessageEvent` deliberately, trading Open/Closed purity for compile-time exhaustive
narrowing, and named the condition under which it should be revisited:

> If third-party or out-of-repo adapters ever become a supported goal, reopen this decision.

That goal has been stated, and the trigger has fired. B-008 measured what the closure actually costs
and what it actually blocks. Two results shape this decision:

1. **ADR-0001's pricing was right.** Adding an eleventh first-party platform costs 4 lines of union
   machinery plus a 2-line exhaustiveness test case — measured by making the edit and running the
   gates, not by reading. The "adding a platform is expensive" argument for reopening is refuted.
2. **The capability gap is real.** An adapter declared in a project outside this monorepo, compiling
   against the published `@theokit/gateway@0.6.1` declaration, fails with
   `TS2416 … Type '"signal"' is not assignable to type 'PlatformName'`.

So the reason to reopen is not cost. It is that out-of-repo authorship is impossible, which is
precisely the condition ADR-0001 named.

## Decision

**Derive both `PlatformName` and `MessageEvent` from an exported `PlatformEventRegistry` interface,
which packages outside this repository extend through TypeScript declaration merging.**

```ts
export interface PlatformEventRegistry {
  telegram: TelegramMessageEvent;
  /* …the ten… */
}
export type PlatformName  = keyof PlatformEventRegistry & string;
export type MessageEvent  = PlatformEventRegistry[keyof PlatformEventRegistry];
```

An interface is chosen over a type alias for one reason: an interface can be augmented via
`declare module` from another package, and a type alias cannot. The union remains a set of literal
keys, so exhaustive narrowing is preserved — including over platforms core has never heard of.

## Consequences

- **Positive.** A gateway can be authored, published and consumed without editing core. Verified by
  compiling one in a project outside the monorepo against the packed build.
- **Positive.** Exhaustiveness survives, and extends to third-party platforms: deleting a
  third-party `case` from a `switch` breaks the build. Verified by mutation.
- **Positive.** A misspelled platform key in an augmentation is still a compile error. There is no
  `string` escape hatch, which is what separates this from opening the union outright.
- **Neutral.** The published type surface is source-compatible: a consumer switching exhaustively
  over the ten compiles unchanged against the new declaration. Verified by installing the packed
  build into a real app.
- **Negative (accepted).** `PlatformName` no longer reads as a list of platforms at its declaration
  site; a reader must open `PlatformEventRegistry` to see them. This is a real legibility cost and
  is accepted for the capability it buys.
- **Negative (accepted).** Declaration merging is invisible to anyone who has not met the pattern.
  It is documented at the declaration and in the authoring guide, and it is the same mechanism
  Fastify and Vite use for the same purpose — which is a note about familiarity, not a justification
  (the justification is the measured TS2416 above).
- **Risk.** The registry must be exported from the barrel. The first measured build emitted it into
  the `.d.ts` but not into the export list, which would have shipped a registry nobody could
  augment. A test that augments through the PUBLISHED entry point is therefore part of the
  implementation, not an optional extra.

## Alternatives considered

1. **Open the union — `PlatformName = KnownPlatform | (string & {})`.** Rejected: prototyped and it
   destroys narrowing (`TS2339: Property 'telegram' does not exist on type 'DiscordEvent'`). It buys
   the capability at exactly the price ADR-0001 refused, and it silently accepts typos.
2. **Infer the event union from the adapter tuple, generically.** Rejected: prototyped, and in the
   mixed case the handler was typed too narrowly — a third-party event would have been handled as a
   first-party one. Unsafe, and the failure was silent.
3. **Keep the union closed; require gateways to live in this repository.** Rejected: this is the
   status quo, and it is the capability gap the item exists about. It remains the correct answer if
   out-of-repo authorship is withdrawn as a goal.
4. **Out-of-process gateways over a wire protocol.** Rejected for this decision: it removes shared
   types entirely rather than extending them, and it answers a different question (polyglot
   authorship) than the one asked here.

## Verification

The decision is not accepted until an implementation shows, in the repository's own suite:

- a consumer switching over all ten platforms compiles unchanged;
- a third-party platform registered through the PUBLISHED entry point narrows correctly;
- deleting the augmentation, deleting a case, or misspelling the key each fails the build.
