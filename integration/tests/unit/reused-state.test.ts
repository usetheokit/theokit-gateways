// Turning "the bootstrap failed" into "the bootstrap found state from a previous run".
//
// Both bootstrap scripts create a server and then create accounts inside it. Run either one
// against a container that already has those accounts and it fails — in two different voices,
// neither of which names the cause:
//
//   matrix:      register theokit-bot failed: {... "errcode":"M_FORBIDDEN",
//                "error":"Invalid registration token"}
//   mattermost:  create first user failed (400): An account with that username already exists.
//
// The first is actively misleading: the token was read from the log and sent correctly, and it is
// "invalid" only because the server already consumed it at first boot. Someone reading that
// message goes looking for a wrong token. Measured cost: two round-trips before the remedy — a
// `:down` — was obvious, and the remedy is one command.
//
// `bootstrap-matrix.ts` already carries this reasoning in prose for the neighbouring case (a
// token the log no longer holds). This covers the case it does not: a token it does hold, spent.

import { describe, expect, it } from "vitest";

import { reusedStateAdvice } from "../../src/reused-state.js";

describe("reusedStateAdvice", () => {
  it("recognises a spent Continuwuity registration token", () => {
    const advice = reusedStateAdvice(
      "matrix",
      'register theokit-bot failed: {"errcode":"M_FORBIDDEN","error":"Invalid registration token"}',
    );

    expect(advice).toContain("previous run");
    expect(advice).toContain("matrix:down");
  });

  it("recognises Mattermost refusing an account it already has", () => {
    const advice = reusedStateAdvice(
      "mattermost",
      "create first user failed (400): An account with that username already exists.",
    );

    expect(advice).toContain("previous run");
    expect(advice).toContain("mattermost:down");
  });

  it("names the platform's own teardown, not the other one's", () => {
    // A remedy that tells you to tear down the wrong server is worse than no remedy: it is
    // confidently actionable and wrong, and it costs a boot cycle to find out.
    expect(reusedStateAdvice("matrix", "Invalid registration token")).not.toContain("mattermost");
    expect(
      reusedStateAdvice("mattermost", "An account with that username already exists"),
    ).not.toContain("matrix:down");
  });

  it("stays silent on a failure it does not recognise", () => {
    // The whole value is that the advice means something. Attaching it to every failure would
    // send someone to recreate a container over a network blip or a wrong port, and would train
    // them to ignore the line — which is how a helpful message becomes noise.
    expect(reusedStateAdvice("matrix", "connect ECONNREFUSED 127.0.0.1:6167")).toBeUndefined();
    expect(reusedStateAdvice("mattermost", "create first user failed (500)")).toBeUndefined();
  });

  it("does not fire when the platform and the signature disagree", () => {
    // Each signature belongs to one server. Matching Mattermost's wording under matrix would be
    // a coincidence, not a diagnosis.
    expect(
      reusedStateAdvice("matrix", "An account with that username already exists"),
    ).toBeUndefined();
  });

  it("reads a signature that arrives with different casing or padding", () => {
    // The text comes from two servers' error bodies, which are not a contract we control.
    expect(reusedStateAdvice("matrix", "  INVALID REGISTRATION TOKEN  ")).toBeDefined();
  });
});
