/**
 * EC-1 to EC-3: the paths where something the verifier depends on misbehaves still end in a typed
 * refusal, never a rejected promise.
 */

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptingValidatorModule, activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";
import { verifierUnderTest } from "./helpers/verifier-under-test.js";

describe("a request the verifier cannot process", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    await ks?.close();
    ks = undefined;
  });

  /** A `fetch` whose response throws from its status getter, which escapes every catch in the read. */
  function stubFetchWithUnreadableStatus() {
    const fetched = vi.fn(async () => ({
      get ok(): boolean {
        throw new RangeError("status unreadable");
      },
    }));
    vi.stubGlobal("fetch", fetched);
    return fetched;
  }

  const readThrew = {
    ok: false,
    reason: "key_set_unavailable",
    message: expect.stringContaining("the read threw (RangeError)"),
  };

  it("refuses as key_set_unavailable when the key-set read rejects on a cold start", async () => {
    ks = await startKeyServer();
    const verify = verifierUnderTest({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      validatorModule: acceptingValidatorModule().module,
    });
    const token = ks.signToken({});
    const fetched = stubFetchWithUnreadableStatus();

    await expect(verify(activityRequest(token))).resolves.toMatchObject(readThrew);
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("refuses as key_set_unavailable when the read for a kid the held copy does not list rejects", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    ks = await startKeyServer();
    const verify = verifierUnderTest({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      validatorModule: acceptingValidatorModule().module,
    });
    const warm = await verify(activityRequest(ks.signToken({})));
    const unlisted = ks.signToken({}, { kid: randomUUID() });
    vi.advanceTimersByTime(10_000);
    const fetched = stubFetchWithUnreadableStatus();

    const res = await verify(activityRequest(unlisted));

    expect([warm.ok, res]).toEqual([true, expect.objectContaining(readThrew)]);
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("refuses a request whose body was already read as body_already_read instead of throwing", async () => {
    ks = await startKeyServer();
    const { module } = acceptingValidatorModule();
    const verify = verifierUnderTest({ clientId: CLIENT_ID, validatorModule: module });
    const req = activityRequest(ks.signToken({}));
    await req.text();

    expect(await verify(req)).toMatchObject({
      ok: false,
      reason: "body_already_read",
      message: expect.stringContaining("request.clone()"),
    });
  });

  it("refuses every request as validator_unavailable when the validator constructor throws", async () => {
    ks = await startKeyServer();
    const verify = verifierUnderTest({
      clientId: CLIENT_ID,
      validatorModule: {
        InboundActivityTokenValidator: class {
          constructor() {
            throw new Error("bad cloud");
          }
        },
      },
    });

    const r1 = await verify(activityRequest(ks.signToken({})));
    const r2 = await verify(activityRequest(ks.signToken({})));

    expect(r1).toMatchObject({ ok: false, reason: "validator_unavailable" });
    expect(r2).toMatchObject({ ok: false, reason: "validator_unavailable" });
  });

  it("refuses as invalid_token when the validator resolves something that is not a token", async () => {
    ks = await startKeyServer();
    let checks = 0;
    const verify = verifierUnderTest({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      validatorModule: {
        InboundActivityTokenValidator: class {
          async check() {
            checks += 1;
            return undefined;
          }
        },
      },
    });

    const res = await verify(activityRequest(ks.signToken({})));

    expect(res).toMatchObject({
      ok: false,
      reason: "invalid_token",
      message: expect.stringContaining("the Teams SDK did not accept the token"),
    });
    expect([checks, ks.hits()]).toEqual([1, 1]);
  });
});
