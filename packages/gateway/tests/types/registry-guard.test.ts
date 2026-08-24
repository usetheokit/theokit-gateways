/**
 * The registry's guard — what may and may not join the platform union.
 *
 * `MessageEvent` derives from `PlatformEventRegistry`, an interface other packages extend by
 * declaration merging. That is the capability B-008 unlocked, and it means the union is no longer
 * written by us: a third party can put anything in it, under any key. This file is the contract on
 * what "anything" is allowed to be.
 *
 * Every case here was found by compiling a hostile augmentation, not by imagining one. Four of them
 * were found in review AFTER a first version of this guard shipped green:
 *
 *   - a value typed `any` collapses the union, after which `tsc --strict` accepts
 *     `event.completelyMadeUpField.nested.nonsense` on every consumer with exit 0;
 *   - `{ [key: string]: BaseMessageEvent }` is a LEGAL augmentation — every variant is assignable
 *     to the base — and widens the platform name to `string`, so every typo becomes valid;
 *   - an entry typed as the base event itself has a non-literal discriminator, and poisons
 *     narrowing for every first-party case;
 *   - an entry whose own `platform` disagrees with its registry key produces a union whose members
 *     contradict their keys, and the error lands on the consumer rather than on the augmentation.
 *
 * **These assertions run under `tsc`, not under vitest.** `pnpm test` alone cannot fail on any of
 * them: with the guard deleted entirely, vitest still reports every test in this file as passing.
 * `typecheck` is the gate that runs them, which is why `packages/gateway`'s `test` script invokes
 * `tsc --noEmit` first — a green vitest summary here means the files were collected, nothing more.
 *
 * Two assertion forms appear here, and which one each case uses was decided by mutation rather
 * than by taste. `Exact<…, never>` detects a guard clause being removed for every case EXCEPT
 * `any`, where it stays green because `any` makes the comparison true either way. The `any` case
 * therefore asserts by ASSIGNMENT behind `@ts-expect-error`, which does detect it. Using either
 * form everywhere leaves half the battery unable to fail — measured, both directions.
 *
 * Assertions are written so that ONE mutation makes them red. An earlier version compared
 * `Registered<any>` to `never` with a type-equality helper and stayed green with the guard deleted,
 * because `any` makes that comparison true either way; and another asserted
 * `Exact<Registered<BaseMessageEvent>, BaseMessageEvent>` under the title "admits a well-formed
 * event shape" — blessing the exact entry that breaks narrowing. Both were caught by mutation, not
 * by reading.
 */

import { describe, expect, it } from "vitest";

import type { MessageEvent, PlatformName } from "../../src/index.js";
import type { BaseMessageEvent, Registered } from "../../src/types/message-event.js";

/** `true` only when `A` and `B` are the same type — stricter than mutual assignability. */
type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * A genuinely well-formed event, differing from the base only in its discriminator.
 *
 * Fixtures below are built from this on purpose. An earlier version wrote three-field literals by
 * hand, and every exclusion test passed for the WRONG reason — the fixture failed
 * `extends BaseMessageEvent` because it was missing `sender`, `channel` and `receivedAt`, so the
 * clause each test claimed to exercise was never reached. Mutation caught it: making the guard
 * distributive left the union test green, because both halves were malformed.
 */
type EventOf<P extends string, Extra = Record<never, never>> = Omit<
  BaseMessageEvent,
  "platform"
> & {
  readonly platform: P;
} & Extra;

/** The ten platforms this package ships. Adding an eleventh must break the assertion below. */
type FirstParty =
  | "telegram"
  | "discord"
  | "slack"
  | "whatsapp"
  | "teams"
  | "email"
  | "sms"
  | "mattermost"
  | "line"
  | "matrix";

describe("PlatformEventRegistry — what may join the union", () => {
  it("is exactly the ten first-party platforms, no more and no fewer", () => {
    // Deliberately `Exact` rather than a length check over a literal array. A length check is a
    // runtime tautology: adding an eleventh platform to the registry leaves it green, because the
    // array is written by hand and never consulted the type. This fails on an addition AND on a
    // removal.
    const exhaustive: Exact<PlatformName, FirstParty> = true;

    expect(exhaustive).toBe(true);
  });

  it("keeps the platform name and the event's discriminator the same set", () => {
    // `PlatformName` derives from the guarded union, so a rejected entry cannot keep contributing
    // its key. Deriving from `keyof` instead let a name exist that no event could ever carry —
    // an adapter could register for a platform that cannot exist.
    const aligned: Exact<PlatformName, MessageEvent["platform"]> = true;

    expect(aligned).toBe(true);
  });

  it("rejects a platform name nobody registered", () => {
    // @ts-expect-error — "signal" is in no registry entry
    const unregistered: PlatformName = "signal";

    expect(unregistered).toBe("signal");
  });

  it("excludes an `any` entry instead of collapsing the union", () => {
    // Asserted by ASSIGNMENT, which is the only form that detects the guard's removal: with the
    // guard, `Registered` yields `never` and nothing is assignable; without it, `any` distributes
    // across both branches, the assignment succeeds, and this directive becomes unused (TS2578).
    // biome-ignore lint/suspicious/noExplicitAny: the defect under test IS `any` in the registry.
    type GuardedAny = Registered<"sloppy", any>;

    // @ts-expect-error — a guarded `any` entry contributes `never`
    const swallowed: GuardedAny = { anything: "at all" };

    expect(swallowed).toBeDefined();
  });

  it("excludes an entry registered under a broad `string` key", () => {
    // The index-signature hole: `{ [key: string]: BaseMessageEvent }` is legal, because every
    // variant is assignable to the base. Without the literal-key gate it widens the whole platform
    // name to `string`.
    type Wide = Registered<string, BaseMessageEvent>;

    const excluded: Exact<Wide, never> = true;

    expect(excluded).toBe(true);
  });

  it("excludes an entry whose discriminator is not a literal", () => {
    // Registering the base event itself: its `platform` is not a single literal, so admitting it
    // would poison narrowing for every first-party case.
    type NotLiteral = Registered<"signal", BaseMessageEvent>;

    const excluded: Exact<NotLiteral, never> = true;

    expect(excluded).toBe(true);
  });

  it("excludes an entry whose discriminator disagrees with its key", () => {
    type Mismatched = Registered<"signal", EventOf<"signl">>;

    const excluded: Exact<Mismatched, never> = true;

    expect(excluded).toBe(true);
  });

  it("excludes a union entry rather than admitting its valid half", () => {
    // The guard is non-distributive on purpose. A distributive one silently keeps the well-formed
    // half of a union entry and drops the rest with no diagnostic.
    type HalfValid = Registered<"half", EventOf<"half"> | { readonly nonsense: true }>;

    const excluded: Exact<HalfValid, never> = true;

    expect(excluded).toBe(true);
  });

  it("drops a rejected entry's key from the platform name, not just its event", () => {
    // The property only becomes observable when a registry HOLDS a rejected entry, which the real
    // one never does — so it is asserted over a hypothetical registry rather than over the shipped
    // one, and the honest consequence is stated here rather than left for someone to discover:
    //
    // **Reverting the source to `PlatformName = keyof PlatformEventRegistry & string` does NOT
    // turn any test in this file red.** Verified by mutation. With a healthy registry the two
    // derivations are the same set, so nothing inside this repository can tell them apart. What
    // this test pins is the MECHANISM — that a rejected entry keeps its key under `keyof` and
    // loses it under the guarded union — and what it cannot pin is which mechanism the source
    // chose. That gap is real and is recorded rather than papered over; the alternative would be
    // a permanently malformed entry in the shipped registry, which is worse than the gap.
    interface Hypothetical {
      good: EventOf<"good">;
      // biome-ignore lint/suspicious/noExplicitAny: the rejected entry under test.
      bad: any;
    }
    type Union = {
      [K in keyof Hypothetical]: Registered<K, Hypothetical[K]>;
    }[keyof Hypothetical];

    const derivedFromUnion: Exact<Union["platform"], "good"> = true;
    const derivedFromKeyof: Exact<keyof Hypothetical & string, "good" | "bad"> = true;

    expect(derivedFromUnion && derivedFromKeyof).toBe(true);
  });

  it("admits a well-formed entry whose discriminator matches its key", () => {
    // The positive control. Without it, a guard that returned `never` for everything would satisfy
    // every exclusion above — which is exactly how the previous version of this file passed while
    // blessing an entry that breaks narrowing.
    type WellFormed = EventOf<"signal", { readonly signal: { readonly uuid: string } }>;
    const admitted: Exact<Registered<"signal", WellFormed>, WellFormed> = true;

    expect(admitted).toBe(true);
  });
});
