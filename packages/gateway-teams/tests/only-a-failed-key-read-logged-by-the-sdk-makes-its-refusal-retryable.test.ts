/**
 * The SDK refuses a token it could not check (its key read failed) with the same plain `Error` it
 * uses for a forgery. The one place the two differ is the line its `JwtValidator` logs first,
 * "Failed to get signing key", through the logger the verifier hands it. Only that line, logged
 * during the `check()` being judged and not for a key the set did not list, turns the refusal into
 * the retryable `key_set_unavailable`. Any other line changes nothing, and a line logged outside a
 * `check()` is no verdict on any token (B-420).
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, SERVICE_URL, startKeyServer } from "./helpers/key-server.js";

interface LoggerLike {
  error(...msg: unknown[]): void;
  child(name: string): LoggerLike;
}

/** A validator module whose `check()` logs `logged` through the SDK logger, then refuses. */
function loggingThenRefusing(logged: unknown[], via: "logger" | "child" = "logger") {
  return {
    InboundActivityTokenValidator: class {
      readonly logger: LoggerLike;
      constructor(_appId: string, _tenant?: string, _serviceUrl?: string, logger?: LoggerLike) {
        this.logger = logger as LoggerLike;
      }
      async check(): Promise<never> {
        const target = via === "child" ? this.logger.child("jwt-validator") : this.logger;
        target.error(...logged);
        throw new Error("Invalid token");
      }
    },
  };
}

const SDK_REFUSED = {
  ok: false,
  reason: "invalid_token",
  message: expect.stringContaining("the Teams SDK did not accept the token"),
};

const SDK_COULD_NOT_READ = {
  ok: false,
  reason: "key_set_unavailable",
  message: expect.stringContaining("the Teams SDK could not read the published signing keys"),
};

describe("a line the SDK logs while checking a token", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  async function verifyWith(module: unknown) {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: module,
    });
    return verify(activityRequest(ks.signToken({})));
  }

  it.each([
    ["with the key client's error as its cause", ["Failed to get signing key", new Error("x")]],
    ["with no cause at all", ["Failed to get signing key"]],
    ["with a null cause", ["Failed to get signing key", null]],
  ])(
    "makes the refusal key_set_unavailable when it is the failed key read %s",
    async (_, logged) => {
      expect(await verifyWith(loggingThenRefusing(logged))).toEqual(SDK_COULD_NOT_READ);
    },
  );

  it("is read through a child logger too", async () => {
    const res = await verifyWith(
      loggingThenRefusing(["Failed to get signing key", new Error("x")], "child"),
    );

    expect(res).toEqual(SDK_COULD_NOT_READ);
  });

  it.each([
    [
      "a key the set did not list (SigningKeyNotFoundError)",
      ["Failed to get signing key", { name: "SigningKeyNotFoundError" }],
    ],
    ["any other text", ["Token has expired", new Error("x")]],
    ["text that only contains the phrase", ["Retry: Failed to get signing key", new Error("x")]],
    ["a value that is not text", [42, new Error("x")]],
  ])("leaves the refusal invalid_token when the line is %s", async (_, logged) => {
    expect(await verifyWith(loggingThenRefusing(logged))).toEqual(SDK_REFUSED);
  });

  it("changes nothing when the SDK logs it and then accepts the token", async () => {
    const res = await verifyWith({
      InboundActivityTokenValidator: class {
        readonly logger: LoggerLike;
        constructor(_appId: string, _tenant?: string, _serviceUrl?: string, logger?: LoggerLike) {
          this.logger = logger as LoggerLike;
        }
        async check(_header: string, body: { serviceUrl: string }) {
          this.logger.error("Failed to get signing key", new Error("x"));
          return { appId: CLIENT_ID, serviceUrl: body.serviceUrl };
        }
      },
    });

    expect(res).toMatchObject({ ok: true, token: { appId: CLIENT_ID, serviceUrl: SERVICE_URL } });
  });

  it("leaves a validator that breaks after logging it validator_unavailable", async () => {
    const res = await verifyWith({
      InboundActivityTokenValidator: class {
        readonly logger: LoggerLike;
        constructor(_appId: string, _tenant?: string, _serviceUrl?: string, logger?: LoggerLike) {
          this.logger = logger as LoggerLike;
        }
        async check(): Promise<never> {
          this.logger.error("Failed to get signing key", new Error("x"));
          throw new TypeError("broken");
        }
      },
    });

    expect(res).toEqual({
      ok: false,
      reason: "validator_unavailable",
      message: expect.stringContaining("(TypeError)"),
    });
  });

  it("is no verdict on any token when logged outside a check, at construction", async () => {
    const res = await verifyWith({
      InboundActivityTokenValidator: class {
        constructor(_appId: string, _tenant?: string, _serviceUrl?: string, logger?: LoggerLike) {
          logger?.error("Failed to get signing key", new Error("x"));
        }
        async check(_header: string, body: { serviceUrl: string }) {
          return { appId: CLIENT_ID, serviceUrl: body.serviceUrl };
        }
      },
    });

    expect(res).toEqual({
      ok: true,
      activity: { type: "message", serviceUrl: SERVICE_URL, channelId: "msteams" },
      token: { appId: CLIENT_ID, serviceUrl: SERVICE_URL },
    });
  });
});
