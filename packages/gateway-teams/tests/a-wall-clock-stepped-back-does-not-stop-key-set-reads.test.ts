/**
 * The key-set read interval and the one-hour age are measured on a monotonic clock
 * (`performance.now()`), not on the wall clock. A host clock stepped backwards (an NTP correction,
 * a VM resumed, a container snapshot restored) used to push the next allowed read into the future
 * by the size of the step, so for that long a key Microsoft had just published was refused as a
 * non-retryable `invalid_token` instead of being read (B-420, F-dom-infra-1).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule, activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

const HOUR_MS = 60 * 60 * 1000;

describe("a wall clock stepped back", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    await ks?.close();
    ks = undefined;
  });

  it("does not delay the read a new key needs once 10 seconds have passed", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
    ks = await startKeyServer();
    const { module } = acceptingValidatorModule();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: module,
    });
    const first = await verify(activityRequest(ks.signToken({})));

    vi.setSystemTime(new Date(Date.now() - HOUR_MS));
    vi.advanceTimersByTime(10_000);
    const rotated = ks.rotate();
    const second = await verify(activityRequest(ks.signWithKid(rotated, {})));

    expect([first.ok, second.ok]).toEqual([true, true]);
    expect(ks.hits()).toBe(2);
  });
});
