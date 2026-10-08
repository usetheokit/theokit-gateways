/**
 * A held key-set copy that lists the token's key answers at once, and is read again in the
 * background only once it is an hour old. Below the hour a listed key costs no read at all, so a
 * sender cannot turn genuine-looking traffic into requests to Microsoft (B-420, ADR-0005).
 *
 * The verifier starts a read by calling `fetch` before its first `await`, so counting `fetch` calls
 * right after `verify` resolves tells whether a read started, with no wait for the background read
 * to land. The validator is a stand-in, so the SDK's own key client makes no request here.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule, activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

const HOUR_MS = 60 * 60 * 1000;

describe("a held key-set copy that lists the key", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await ks?.close();
    ks = undefined;
  });

  async function warmVerifier() {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
    ks = await startKeyServer();
    const keys = `${ks.cloud.loginEndpoint}/keys`;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const reads = () => fetchSpy.mock.calls.filter(([url]) => String(url) === keys).length;
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: acceptingValidatorModule().module,
    });
    const first = await verify(activityRequest(ks.signToken({})));
    expect([first.ok, reads()]).toEqual([true, 1]);
    return { ks, verify, reads };
  }

  it("is not read again one millisecond short of an hour", async () => {
    const { ks, verify, reads } = await warmVerifier();

    vi.advanceTimersByTime(HOUR_MS - 1);
    const res = await verify(activityRequest(ks.signToken({})));

    expect([res.ok, reads()]).toEqual([true, 1]);
  });

  it("is read again, in the background, once it is exactly an hour old", async () => {
    const { ks, verify, reads } = await warmVerifier();

    vi.advanceTimersByTime(HOUR_MS);
    const res = await verify(activityRequest(ks.signToken({})));

    expect([res.ok, reads()]).toEqual([true, 2]);
  });
});
