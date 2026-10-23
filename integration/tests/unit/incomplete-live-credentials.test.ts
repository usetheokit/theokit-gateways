/**
 * A live suite with only some of its variables set fails naming the missing ones, instead of
 * skipping as if none were set (EC-19). A half-configured environment is a mistake to report; a
 * skip would read as "nothing to run here".
 */

import { describe, expect, it } from "vitest";

import { incompleteFor } from "../../src/credentials.js";
import { platformById } from "../../src/platforms.js";

const NOSTR = platformById("nostr");

describe("incompleteFor", () => {
  it("names the missing variables when some of the platform's variables are set", () => {
    const set = new Set(["NOSTR_SECRET_KEY"]);

    expect(incompleteFor(NOSTR, (name) => set.has(name))).toEqual([
      "NOSTR_RELAY_URL",
      "NOSTR_PEER_SECRET_KEY",
    ]);
  });

  it("names nothing when none is set, so the suite skips", () => {
    expect(incompleteFor(NOSTR, () => false)).toEqual([]);
  });

  it("names nothing when every one is set", () => {
    expect(incompleteFor(NOSTR, () => true)).toEqual([]);
  });
});
