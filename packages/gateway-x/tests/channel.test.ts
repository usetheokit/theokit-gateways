import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { XAdapter } from "../src/adapter.js";
import { xChannel } from "../src/channel.js";

const ENV = {
  APP_X_USER_ID: "1",
  APP_X_USERNAME: "bot",
  APP_X_CLIENT_ID: "cid",
  APP_X_CLIENT_SECRET: "csecret",
  APP_X_REFRESH_TOKEN: "rtoken",
  APP_X_ALLOW_FROM: "alice, @bob",
  APP_X_BEARER_TOKEN: "btoken",
  APP_X_GUEST_DAILY_LIMIT: "3",
};

const VALID = {
  userId: "1",
  username: "bot",
  clientId: "cid",
  clientSecret: "csecret",
  refreshToken: "rtoken",
  allowFrom: ["alice"],
};

function errorOf(fn: () => unknown): GatewayConfigurationError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GatewayConfigurationError);
    return err as GatewayConfigurationError;
  }
  throw new Error("nothing thrown");
}

describe("xChannel", () => {
  it("builds the adapter from configFromEnv", () => {
    const { config, missing } = configFromEnv(xChannel, ENV, "APP_");
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: xChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(XAdapter);
  });

  it("rejects with missing_required_config and names the variable", () => {
    for (const field of xChannel.config.filter((f) => f.required)) {
      const env: Record<string, string> = { ...ENV };
      delete env[`APP_${field.env}`];
      const { config, missing } = configFromEnv(xChannel, env, "APP_");
      expect(missing).toEqual([`APP_${field.env}`]);
      const { rejected } = createChannels([{ descriptor: xChannel, config, envPrefix: "APP_" }]);
      expect(rejected[0]?.error.code).toBe("missing_required_config");
      expect(rejected[0]?.error.message).toContain(`APP_${field.env}`);
    }
  });

  it("collects exactly the secret values", () => {
    expect(configFromEnv(xChannel, ENV, "APP_").secrets.toSorted()).toEqual(
      ["btoken", "csecret", "rtoken"].toSorted(),
    );
  });

  it("refuses a wrongly typed value naming the key", () => {
    const error = errorOf(() => xChannel.create({ ...VALID, clientId: 42 }));
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain("clientId");
  });

  it("refuses an empty allowFrom", () => {
    for (const allowFrom of [[], "", " , ", [" "], ["@"], "@, @"]) {
      const error = errorOf(() => xChannel.create({ ...VALID, allowFrom }));
      expect(error.code).toBe("invalid_config");
      expect(error.message).toContain("allowFrom");
    }
  });

  it("refuses a non-string allowFrom entry", () => {
    expect(errorOf(() => xChannel.create({ ...VALID, allowFrom: [1] })).message).toContain(
      "allowFrom",
    );
  });

  it("accepts guestDailyLimit as a number or digit string, else refuses", () => {
    expect(xChannel.create({ ...VALID, guestDailyLimit: 5 })).toBeInstanceOf(XAdapter);
    expect(xChannel.create({ ...VALID, guestDailyLimit: "5" })).toBeInstanceOf(XAdapter);
    for (const bad of ["0", 0, -1, "1.5", "abc", true]) {
      const error = errorOf(() => xChannel.create({ ...VALID, guestDailyLimit: bad }));
      expect(error.code).toBe("invalid_config");
      expect(error.message).toContain("guestDailyLimit");
    }
  });

  it("refuses null and empty optional values instead of ignoring them", () => {
    for (const extra of [
      { bearerToken: null },
      { bearerToken: "" },
      { guestDailyLimit: null },
      { guestDailyLimit: "" },
    ]) {
      const error = errorOf(() => xChannel.create({ ...VALID, ...extra }));
      expect(error.code).toBe("invalid_config");
      expect(error.message).toContain(Object.keys(extra)[0]);
    }
  });

  it("declares socket transport and no webhook", () => {
    expect(xChannel.transport).toBe("socket");
    expect("webhook" in xChannel).toBe(false);
  });
});
