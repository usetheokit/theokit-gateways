# ADR-0002 — `MessageEvent` derives from an augmentable platform registry

- Status: Accepted (implemented 2026-08-23; see § Verification)
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

/** A registry key must be a literal, never the broad `string` an index signature produces. */
type LiteralKey<K> = string extends K ? never : K;

/** An entry joins only if it is a real event shape whose discriminator equals its own key. */
export type Registered<K, T> = IsAny<T> extends true
  ? never
  : [T] extends [BaseMessageEvent]
    ? [T] extends [{ readonly platform: LiteralKey<K> }]
      ? [LiteralKey<K>] extends [never] ? never : T
      : never
    : never;

export type MessageEvent = {
  [K in keyof PlatformEventRegistry]: Registered<K, PlatformEventRegistry[K]>;
}[keyof PlatformEventRegistry];

/** Derived from the GUARDED union, so a name and an event can never disagree. */
export type PlatformName = MessageEvent["platform"];
```

An interface is chosen over a type alias for one reason: an interface can be augmented via
`declare module` from another package, and a type alias cannot. The union remains a set of literal
keys, so exhaustive narrowing is preserved — including over platforms core has never heard of.

**Both sides of an augmentation are gated, and an earlier draft of this ADR gated neither.** That
draft recorded the derivation as a bare `PlatformEventRegistry[keyof PlatformEventRegistry]`, which
review measured to fail four ways — each by compiling a hostile augmentation, none by argument:

| Augmentation | What it did to the bare derivation |
|---|---|
| `sloppy: any` | collapsed the whole union; `tsc --strict` then accepted `event.completelyMadeUpField.nested.nonsense` on every consumer with **exit 0** |
| `[key: string]: BaseMessageEvent` | legal, because every variant is assignable to the base — widened `PlatformName` to `string`, so every typo became valid |
| `signal: BaseMessageEvent` | admitted an entry whose discriminator is not a literal, breaking narrowing for every first-party case |
| `signal: { platform: "signl"; … }` | key and discriminator disagreed; the error landed on the *consumer's* `switch`, not on the augmentation |

The closed union this ADR supersedes could not fail any of those ways. Recording the derivation
without the guard would have traded a real safety property for the new capability instead of keeping
both — and it would have done so in the only record that travels with the repository, since the
detailed plan lives under `.claude/`, which `.gitignore` excludes.

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
- **Negative (accepted).** `BaseMessageEvent.platform` widens from `PlatformName` to `string`. It
  has to: `PlatformName` is now derived from the guarded union, and the union is built from shapes
  that extend the base, so naming it there makes the two reference each other (`TS2456`). Every
  concrete variant still narrows the field to its own literal, and no production code in this
  repository reads `platform` off a bare `BaseMessageEvent`. A published consumer that assigns
  `baseEvent.platform` into a `PlatformName` slot would break; a consumer holding a `MessageEvent`
  is unaffected.
- **Negative (corrected).** An excluded entry is NOT free for first-party consumers. A
  `Record<PlatformName, T>` written against the ten fails to compile when a rejected key disappears
  from `PlatformName`. An earlier version of this ADR and of the source docblock claimed first-party
  consumers were untouched; that was measured false in review. What the exclusion buys is a
  missing-key error at the consumer's own map instead of a silent loss of narrowing everywhere.
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
