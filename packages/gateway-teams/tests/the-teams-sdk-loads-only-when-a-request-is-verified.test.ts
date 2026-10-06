/**
 * NFR-005: importing the package and building a verifier loads no Teams SDK code; the first
 * request does, once. An SDK that cannot be imported refuses instead of throwing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { acceptingValidatorModule, activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

const MIDDLEWARE = "@microsoft/teams.apps/dist/middleware/index.js";

describe("the Teams SDK load", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    vi.doUnmock(MIDDLEWARE);
    vi.resetModules();
    await ks?.close();
    ks = undefined;
  });

  it("imports the Teams SDK only when the first request is verified", async () => {
    ks = await startKeyServer();
    let imports = 0;
    const { module, calls } = acceptingValidatorModule();
    vi.resetModules();
    vi.doMock(MIDDLEWARE, () => {
      imports += 1;
      return module;
    });
    const { teamsActivityVerifier } = await import("../src/index.js");

    const verify = teamsActivityVerifier({ clientId: CLIENT_ID });
    expect(imports).toBe(0);

    const r1 = await verify(activityRequest(ks.signToken({})));
    const r2 = await verify(activityRequest(ks.signToken({})));

    expect(imports).toBe(1);
    expect(calls.ctor.length).toBe(1);
    expect([r1.ok, r2.ok]).toEqual([true, true]);
  });

  it("refuses as validator_unavailable naming the module when the SDK cannot be imported", async () => {
    ks = await startKeyServer();
    vi.resetModules();
    vi.doMock(MIDDLEWARE, () => {
      throw new Error("Cannot find module '@microsoft/teams.apps'");
    });
    const { teamsActivityVerifier } = await import("../src/index.js");
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID });

    const res = await verify(activityRequest(ks.signToken({})));

    expect(res).toMatchObject({ ok: false, reason: "validator_unavailable" });
    if (!res.ok) expect(res.message).toContain("dist/middleware/index.js");
  });
});
