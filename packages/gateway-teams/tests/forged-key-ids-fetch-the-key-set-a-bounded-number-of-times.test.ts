/**
 * A token's `kid` is chosen by whoever sent the request, and the SDK fetches the key set for a kid
 * it has not cached before any signature check. So the verifier lets at most ten tokens per minute
 * whose kid no accepted token used reach the SDK; a kid an accepted token used is never limited.
 */

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

describe("forged key ids", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    await ks?.close();
    ks = undefined;
  });

  async function verifierWithKeys() {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    ks = await startKeyServer();
    return { ks, verify: teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud }) };
  }

  const forged = (ks: KeyServer) => ks.signToken({}, { alg: "none", kid: randomUUID() });

  /** A three-segment token whose header is `header`, with a valid payload and no signature. */
  const withHeader = (ks: KeyServer, header: Record<string, unknown>) => {
    const [, payload] = ks.signToken({}).split(".");
    return `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${payload}.`;
  };

  it("spend no key-set capacity on a bearer that is not a JWT or whose header names no string kid", async () => {
    const { ks, verify } = await verifierWithKeys();
    const keyless = [
      "x",
      "a.b",
      "!!!.e30.",
      withHeader(ks, { alg: "RS256", typ: "JWT" }),
      withHeader(ks, { alg: "RS256", typ: "JWT", kid: 7 }),
      withHeader(ks, { alg: "RS256", typ: "JWT", kid: "" }),
    ];

    const refused = [];
    for (let i = 0; i < 4; i += 1) {
      for (const token of keyless) refused.push(await verify(activityRequest(token)));
    }
    const hitsAfterKeyless = ks.hits();
    for (let i = 0; i < 10; i += 1) await verify(activityRequest(forged(ks)));

    expect(refused.every((r) => !r.ok && r.reason === "invalid_token")).toBe(true);
    expect([hitsAfterKeyless, ks.hits()]).toEqual([0, 10]);
  });

  it("make at most 10 key-set requests for 20 unsigned tokens with fresh kids in one minute", async () => {
    const { ks, verify } = await verifierWithKeys();

    const results = [];
    for (let i = 0; i < 20; i += 1) results.push(await verify(activityRequest(forged(ks))));

    expect(results.every((r) => !r.ok && r.reason === "invalid_token")).toBe(true);
    expect(ks.hits()).toBe(10);
  });

  it("refuse the eleventh fresh kid with a message that names neither the kid nor the token", async () => {
    const { ks, verify } = await verifierWithKeys();
    for (let i = 0; i < 10; i += 1) await verify(activityRequest(forged(ks)));
    const token = forged(ks);

    const res = await verify(activityRequest(token));

    expect(res).toMatchObject({
      ok: false,
      reason: "invalid_token",
      message: expect.stringContaining("signing key no accepted token used"),
    });
    expect(JSON.stringify(res).includes(token)).toBe(false);
    expect(ks.hits()).toBe(10);
  });

  it("make one more key-set request once exactly 60 seconds have passed", async () => {
    const { ks, verify } = await verifierWithKeys();
    for (let i = 0; i < 10; i += 1) await verify(activityRequest(forged(ks)));

    vi.advanceTimersByTime(59_999);
    await verify(activityRequest(forged(ks)));
    const beforeWindow = ks.hits();
    vi.advanceTimersByTime(1);
    await verify(activityRequest(forged(ks)));

    expect([beforeWindow, ks.hits()]).toEqual([10, 11]);
  });

  it("never limit a token whose kid an accepted token already used", async () => {
    const { ks, verify } = await verifierWithKeys();
    const first = await verify(activityRequest(ks.signToken({})));
    for (let i = 0; i < 20; i += 1) await verify(activityRequest(forged(ks)));

    const after = await verify(activityRequest(ks.signToken({})));

    expect([first.ok, after.ok]).toEqual([true, true]);
  });

  it("do not learn a kid whose token the SDK refused", async () => {
    const { ks, verify } = await verifierWithKeys();
    const kid = randomUUID();
    await verify(activityRequest(ks.signToken({}, { alg: "none", kid })));
    for (let i = 0; i < 9; i += 1) await verify(activityRequest(forged(ks)));

    await verify(activityRequest(ks.signToken({}, { alg: "none", kid })));

    expect(ks.hits()).toBe(10);
  });
});
