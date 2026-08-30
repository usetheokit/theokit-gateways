/**
 * A provisioned platform is ready only if its server answers.
 *
 * Measured 2026-08-28: `MATRIX_*` and `MATTERMOST_*` were present in `.env`, readiness reported both
 * as `[ready]`, and the live suite then failed 16 tests because neither container was running. For
 * these two the variables are WRITTEN BY the bootstrap script, so their presence proves the server
 * was once up — never that it is up now. Credentials cannot answer that question, and readiness
 * exists precisely to answer it before a live run pays for it.
 */

import { describe, expect, it } from "vitest";

import { optional } from "../../src/credentials.js";
import { PLATFORMS } from "../../src/platforms.js";
import { reachabilityOf, unreachable } from "../../src/reachability.js";

describe("reachability", () => {
  it("declares which platforms are only ready when a server answers", () => {
    // Exactly the two whose credentials are provisioned by a bootstrap script.
    const declared = PLATFORMS.filter((p) => p.reachableVia !== undefined).map((p) => p.id);
    expect(declared.sort()).toEqual(["matrix", "mattermost"]);
  });

  it("reports a platform whose URL nothing is listening on as unreachable", async () => {
    // Port 1 is reserved and never bound, so this asserts the check FAILS when it should — the half
    // that a green run can never demonstrate.
    expect(await unreachable("http://127.0.0.1:1")).toBe(true);
  });

  it("reports a URL that answers as reachable, whatever the status code", async () => {
    // A homeserver root may answer 404 and still be up. The question is whether anything is there.
    const url = optional("MATRIX_HOMESERVER_URL");
    if (url === undefined || url === "") return; // nothing provisioned: nothing to assert
    expect(await unreachable(url)).toBe(false);
  });

  it("says nothing about platforms that declare no server of their own", async () => {
    const telegram = PLATFORMS.find((p) => p.id === "telegram");
    expect(telegram?.reachableVia).toBeUndefined();
    expect(await reachabilityOf(telegram!)).toBeUndefined();
  });
});
