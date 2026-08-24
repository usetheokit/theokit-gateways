/**
 * The registry's guard — what may and may not join the platform union.
 *
 * `MessageEvent` derives from `PlatformEventRegistry`, an interface other packages extend by
 * declaration merging. That is the capability B-008 exists to unlock, and it means the union is no
 * longer written by us: a third party can put anything in it. This file is the contract on what
 * "anything" is allowed to be.
 *
 * The case that motivates the file was measured, not imagined. A single entry typed `any` makes
 * `PlatformEventRegistry[keyof PlatformEventRegistry]` resolve to `any`, and from that moment
 * `tsc --strict` accepts nonsense on every consumer of `MessageEvent` — ours included — with no
 * error in any package and nothing red in any suite. The closed union could not fail that way, so a
 * registry without the guard would trade a real safety property for the new capability rather than
 * keeping both (ADR D425).
 *
 * These assert against `Registered`, the ACTUAL guard the derivation uses, imported from the module
 * that declares it. Asserting against a local copy of the same conditional would test the copy —
 * it would stay green with the real guard deleted, which is the one thing a regression must not do.
 *
 * They are type-level, so `tsc` is what runs them; `vitest` only proves the file is collected.
 */

import { describe, expect, it } from "vitest";

import type { BaseMessageEvent, MessageEvent, PlatformName } from "../../src/index.js";
import type { Registered } from "../../src/types/message-event.js";

/** Resolves to `true` only when `A` and `B` are the same type — stricter than assignability. */
type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe("PlatformEventRegistry — what may join the union", () => {
  it("admits every first-party platform name", () => {
    // EDGE — the ten valid values, at the boundary of what the registry declares.
    const names: PlatformName[] = [
      "telegram",
      "discord",
      "slack",
      "whatsapp",
      "teams",
      "email",
      "sms",
      "mattermost",
      "line",
      "matrix",
    ];

    expect(names).toHaveLength(10);
  });

  it("rejects a platform name nobody registered", () => {
    // NEGATIVE — the first invalid value past the boundary. Without an augmentation a foreign
    // literal is not a `PlatformName`, which is what stops a typo from being accepted silently.
    // @ts-expect-error — "signal" is in no registry entry
    const unregistered: PlatformName = "signal";

    expect(unregistered).toBe("signal");
  });

  it("keeps the common event fields reachable on the union", () => {
    // If a bad entry escaped the guard, this is the assertion that stops resolving — which is how
    // a careless third-party augmentation would otherwise reach first-party consumers.
    const anyEvent = null as unknown as MessageEvent;
    const asBase: BaseMessageEvent = anyEvent;

    expect(asBase).toBeNull();
  });

  it("excludes an `any` entry instead of collapsing the union (ADR D425)", () => {
    // The measured failure, asserted against the real guard — and asserted by ASSIGNMENT, which is
    // the only form that detects the guard's removal.
    //
    // With the guard, `Registered<any>` is `never`, nothing is assignable to it, and the
    // `@ts-expect-error` below is used. Delete the `IsAny` arm and `any` distributes across both
    // branches of the remaining conditional, `Registered<any>` becomes `any`, the assignment
    // succeeds, and the directive turns into an unused-directive error. That is the RED.
    //
    // An earlier version of this test compared `Registered<any>` to `never` with a type-equality
    // helper. It passed with the guard deleted: `any` makes the comparison resolve `true` either
    // way. It was caught by running the mutation rather than by reading the test, which is the only
    // way this class of defect is ever caught.
    // biome-ignore lint/suspicious/noExplicitAny: the defect under test IS `any` in the registry.
    type GuardedAny = Registered<any>;

    // @ts-expect-error — a guarded `any` entry contributes `never`, so nothing is assignable to it
    const swallowed: GuardedAny = { anything: "at all" };

    expect(swallowed).toBeDefined();
  });

  it("excludes an entry that is not an event shape at all", () => {
    // NEGATIVE — a third party registers something that does not extend the base event. The guard
    // keeps it out, so first-party consumers reading `event.text` are unaffected and the damage
    // stays with the author whose own `case` will not narrow.
    const excluded: Exact<Registered<{ nonsense: true }>, never> = true;

    expect(excluded).toBe(true);
  });

  it("admits a well-formed event shape", () => {
    // EDGE — the guard must not be so strict that it rejects valid entries. Without this, a guard
    // that returned `never` for everything would pass every negative case above.
    const admitted: Exact<Registered<BaseMessageEvent>, BaseMessageEvent> = true;

    expect(admitted).toBe(true);
  });
});
