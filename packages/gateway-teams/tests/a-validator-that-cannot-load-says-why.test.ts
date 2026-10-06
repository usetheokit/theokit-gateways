/**
 * A `validator_unavailable` refusal names the kind of failure behind it (the error's class and,
 * when it has one, its code), so an operator can tell a missing module from a broken SDK. It never
 * carries the error's own text, which belongs to the SDK and is not the verifier's to repeat.
 */

import { afterEach, describe, expect, it } from "vitest";

import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

const PRIVATE_TEXT = "private-detail-7f3a";

describe("a validator that cannot load", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("names the import error's code in validator_unavailable without its text", async () => {
    ks = await startKeyServer();
    // A module seam that rejects when awaited stands in for a failed import: vi.doMock wraps a
    // factory's error in its own, which would hide the code Node puts on a real import failure.
    const failedImport = {
      // biome-ignore lint/suspicious/noThenProperty: a thenable is the shape of a failed dynamic import
      then(_resolve: unknown, reject: (reason: unknown) => void) {
        reject(
          Object.assign(new Error(`Cannot find module ${PRIVATE_TEXT}`), {
            code: "ERR_MODULE_NOT_FOUND",
          }),
        );
      },
    };
    const { teamsActivityVerifier } = await import("../src/index.js");
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, __validatorModule: failedImport });

    const res = await verify(activityRequest(ks.signToken({})));

    expect(res).toMatchObject({ ok: false, reason: "validator_unavailable" });
    expect(res.ok ? "" : res.message).toContain("ERR_MODULE_NOT_FOUND");
    expect(res.ok ? "" : res.message).not.toContain(PRIVATE_TEXT);
  });

  it("names the constructor error's class in validator_unavailable without its text", async () => {
    ks = await startKeyServer();
    const { teamsActivityVerifier } = await import("../src/index.js");
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      __validatorModule: {
        InboundActivityTokenValidator: class {
          constructor() {
            throw new RangeError(PRIVATE_TEXT);
          }
        },
      },
    });

    const res = await verify(activityRequest(ks.signToken({})));

    expect(res).toMatchObject({ ok: false, reason: "validator_unavailable" });
    expect(res.ok ? "" : res.message).toContain("RangeError");
    expect(res.ok ? "" : res.message).not.toContain(PRIVATE_TEXT);
  });

  it.each([
    [
      "a name and a code that are not identifiers",
      Object.assign(new Error("x"), { name: `Bad ${PRIVATE_TEXT}`, code: `E ${PRIVATE_TEXT}` }),
      "(an unnamed error)",
    ],
    ["a thrown null", null, "(a thrown object)"],
  ])("refuses a constructor failure with %s without repeating it", async (_, thrown, kind) => {
    ks = await startKeyServer();
    const { teamsActivityVerifier } = await import("../src/index.js");
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      __validatorModule: {
        InboundActivityTokenValidator: class {
          constructor() {
            throw thrown;
          }
        },
      },
    });

    const res = await verify(activityRequest(ks.signToken({})));

    expect(res.ok ? "" : res.message).toContain(kind);
    expect(res.ok ? "" : res.message).not.toContain(PRIVATE_TEXT);
  });
});
