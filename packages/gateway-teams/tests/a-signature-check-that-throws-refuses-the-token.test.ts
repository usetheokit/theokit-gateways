/**
 * `crypto.verify` answers `false` for every bad signature this verifier can be sent; measured over
 * empty, short, long and all-ones signatures and moduli from 2 to 64 bytes, it never throws for an
 * RSA key. A throw would be the crypto layer failing, not a verdict. The verifier fails closed on
 * it: the token is `invalid_token` and the SDK is never asked. Node's `verify` is replaced here,
 * because no input reaches that throw through the real one (B-420).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const crypto = vi.hoisted(() => ({ verifyThrows: false }));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    verify: (...args: Parameters<typeof actual.verify>) => {
      if (crypto.verifyThrows) throw new Error("OpenSSL failure");
      return actual.verify(...args);
    },
  };
});

const { teamsActivityVerifier } = await import("../src/index.js");
const { acceptingValidatorModule, activityRequest } = await import("./helpers/claim-fixtures.js");
const { CLIENT_ID, startKeyServer } = await import("./helpers/key-server.js");

describe("a signature check that throws", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    crypto.verifyThrows = false;
    await close?.();
    close = undefined;
  });

  it("refuses the token as a bad signature and never asks the SDK", async () => {
    const ks = await startKeyServer();
    close = ks.close;
    const { module, calls } = acceptingValidatorModule();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: module,
    });
    crypto.verifyThrows = true;

    const res = await verify(activityRequest(ks.signToken({})));

    expect(res).toEqual({
      ok: false,
      reason: "invalid_token",
      message: expect.stringContaining("signature does not verify"),
    });
    expect(calls.check).toBe(0);
  });
});
