/**
 * `loadValidator` and `sdkCheck` turn the SDK validator's answer into a verdict: a resolved token, a
 * refusal on the merits (`undefined`), or a refusal that is no verdict on the token at all. Driven
 * here by a stand-in validator, with no key server: the rules are the module's, not the SDK's.
 */

import { describe, expect, it } from "vitest";

import { loadValidator, sdkCheck, type TokenValidatorLike } from "../src/sdk-validator.js";

const CLIENT_ID = "00000000-0000-0000-0000-0000000000a1";
const ACTIVITY = { serviceUrl: "https://smba.trafficmanager.net/amer/" };

type Logger = { error(...msg: unknown[]): void };

/** A validator module whose `check` runs `behaviour` with the logger the verifier handed it. */
function moduleWith(behaviour: (logger: Logger) => Promise<unknown>): Record<string, unknown> {
  class StandInValidator {
    readonly #logger: Logger;
    constructor(_appId: string, _tenantId?: string, _serviceUrl?: string, logger?: Logger) {
      this.#logger = logger as Logger;
    }
    check(): Promise<unknown> {
      return behaviour(this.#logger);
    }
  }
  return { InboundActivityTokenValidator: StandInValidator };
}

async function validatorFor(mod: unknown): Promise<TokenValidatorLike> {
  const loaded = await loadValidator({ clientId: CLIENT_ID, __validatorModule: mod });
  if (!("validator" in loaded)) throw new Error(`stand-in did not load: ${loaded.unavailable}`);
  return loaded.validator;
}

describe("sdkCheck", () => {
  it("answers the token the SDK resolved", async () => {
    const validator = await validatorFor(
      moduleWith(async () => ({ appId: CLIENT_ID, serviceUrl: ACTIVITY.serviceUrl, extra: 1 })),
    );

    await expect(sdkCheck(validator, "Bearer t", ACTIVITY)).resolves.toEqual({
      appId: CLIENT_ID,
      serviceUrl: ACTIVITY.serviceUrl,
    });
  });

  it("reads an answer without a string appId as a refusal", async () => {
    const validator = await validatorFor(moduleWith(async () => ({ serviceUrl: "x" })));

    await expect(sdkCheck(validator, "Bearer t", ACTIVITY)).resolves.toBeUndefined();
  });

  it("reads a plain Error as the SDK refusing the token", async () => {
    const validator = await validatorFor(
      moduleWith(async () => {
        throw new Error("Invalid token");
      }),
    );

    await expect(sdkCheck(validator, "Bearer t", ACTIVITY)).resolves.toBeUndefined();
  });

  it("reads a TypeError as the validator failing, naming only its class", async () => {
    const validator = await validatorFor(
      moduleWith(async () => {
        throw new TypeError("secret detail from the SDK");
      }),
    );

    const verdict = await sdkCheck(validator, "Bearer t", ACTIVITY);

    expect(verdict).toMatchObject({ ok: false, reason: "validator_unavailable" });
    expect(JSON.stringify(verdict)).toContain("(TypeError)");
    expect(JSON.stringify(verdict)).not.toContain("secret detail");
  });

  it("reads a refusal after a failed signing-key read as key_set_unavailable", async () => {
    const validator = await validatorFor(
      moduleWith(async (logger) => {
        logger.error("Failed to get signing key", new Error("socket hang up"));
        throw new Error("Invalid token");
      }),
    );

    await expect(sdkCheck(validator, "Bearer t", ACTIVITY)).resolves.toMatchObject({
      ok: false,
      reason: "key_set_unavailable",
    });
  });

  it("reads a refusal after a key the set does not list as a refusal on the merits", async () => {
    const notFound = Object.assign(new Error("no key"), { name: "SigningKeyNotFoundError" });
    const validator = await validatorFor(
      moduleWith(async (logger) => {
        logger.error("Failed to get signing key", notFound);
        throw new Error("Invalid token");
      }),
    );

    await expect(sdkCheck(validator, "Bearer t", ACTIVITY)).resolves.toBeUndefined();
  });

  it("does not carry a failed key read from one check into the next", async () => {
    let calls = 0;
    const validator = await validatorFor(
      moduleWith(async (logger) => {
        calls += 1;
        if (calls === 1) logger.error("Failed to get signing key", new Error("timeout"));
        throw new Error("Invalid token");
      }),
    );

    await sdkCheck(validator, "Bearer t", ACTIVITY);

    await expect(sdkCheck(validator, "Bearer t", ACTIVITY)).resolves.toBeUndefined();
  });
});

describe("loadValidator", () => {
  it("names a module that exports neither validator class", async () => {
    const loaded = await loadValidator({ clientId: CLIENT_ID, __validatorModule: {} });

    expect(loaded).toEqual({ unavailable: expect.stringContaining("found neither class") });
  });

  it("reads the classes from a module's default export", async () => {
    const mod = { default: moduleWith(async () => ({ appId: CLIENT_ID, serviceUrl: "s" })) };

    await expect(loadValidator({ clientId: CLIENT_ID, __validatorModule: mod })).resolves.toEqual({
      validator: expect.anything(),
      acceptsTenantIssued: true,
    });
  });

  it("names a validator whose constructor throws by the error's class", async () => {
    class Throwing {
      constructor() {
        throw new RangeError("bad cloud");
      }
    }
    const loaded = await loadValidator({
      clientId: CLIENT_ID,
      __validatorModule: { ServiceTokenValidator: Throwing },
    });

    expect(loaded).toEqual({
      unavailable: expect.stringMatching(/could not construct .*\(RangeError\)$/),
    });
  });
});
