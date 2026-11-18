import {
  type ChannelDescriptor,
  configFromEnv,
  createChannels,
  GatewayConfigurationError,
} from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { XAdapter } from "../src/adapter.js";
import { xChannel } from "../src/channel.js";

const descriptor = xChannel as unknown as ChannelDescriptor;

const ENV: Record<string, string> = {
  APP_X_USER_ID: "u1",
  APP_X_USERNAME: "bot",
  APP_X_CLIENT_ID: "cid",
  APP_X_CLIENT_SECRET: "csec",
  APP_X_REFRESH_TOKEN: "rtok",
  APP_X_ALLOW_FROM: "1,2",
  APP_X_BEARER_TOKEN: "btok",
};
const VALUES: Record<string, unknown> = {
  userId: "u1",
  username: "bot",
  clientId: "cid",
  clientSecret: "csec",
  refreshToken: "rtok",
  allowFrom: "1,2",
  bearerToken: "btok",
};

function refusal(config: Record<string, unknown>): GatewayConfigurationError {
  try {
    xChannel.create(config);
  } catch (err) {
    return err as GatewayConfigurationError;
  }
  throw new Error("create did not throw");
}

describe("xChannel", () => {
  it("builds the adapter through createChannels from configFromEnv", () => {
    const env = configFromEnv(descriptor, ENV, "APP_");
    expect(env.missing).toEqual([]);
    const result = createChannels([{ descriptor, config: env.config, envPrefix: "APP_" }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(XAdapter);
  });

  it.each([
    "APP_X_USER_ID",
    "APP_X_USERNAME",
    "APP_X_CLIENT_ID",
    "APP_X_CLIENT_SECRET",
    "APP_X_REFRESH_TOKEN",
    "APP_X_ALLOW_FROM",
  ])("a missing %s is rejected naming the full variable", (name) => {
    const source = { ...ENV };
    delete source[name];
    const env = configFromEnv(descriptor, source, "APP_");
    expect(env.missing).toEqual([name]);
    const result = createChannels([{ descriptor, config: env.config, envPrefix: "APP_" }]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain(name);
  });

  it("lists exactly the secret values in configFromEnv(...).secrets", () => {
    const env = configFromEnv(descriptor, ENV, "APP_");
    expect([...env.secrets].sort()).toEqual(["btok", "csec", "rtok"]);
    const secretKeys = xChannel.config.filter((f) => f.secret).map((f) => f.key);
    expect(secretKeys.map((k) => VALUES[k]).sort()).toEqual(["btok", "csec", "rtok"]);
  });

  it.each(["userId", "username", "clientId", "clientSecret", "refreshToken", "allowFrom"])(
    "refuses a wrongly typed %s with invalid_config",
    (key) => {
      const error = refusal({ ...VALUES, [key]: { not: "valid" } });
      expect(error).toBeInstanceOf(GatewayConfigurationError);
      expect(error.code).toBe("invalid_config");
      expect(error.message).toContain(key);
    },
  );

  it("builds with the optional guest limit as a digit string or number", () => {
    expect(xChannel.create({ ...VALUES, guestDailyLimit: "5" })).toBeInstanceOf(XAdapter);
    expect(xChannel.create({ ...VALUES, allowFrom: ["1"], guestDailyLimit: 5 })).toBeInstanceOf(
      XAdapter,
    );
  });

  it.each(["0", "-1", "1.5", "abc", "", null, 0, true])("refuses guestDailyLimit %j", (value) => {
    const error = refusal({ ...VALUES, guestDailyLimit: value });
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain("guestDailyLimit");
  });

  it.each([[], "", " , ", "1,,2", [" "], ["@"], ["1", " @ "], "@"])(
    "refuses allowFrom %j",
    (value) => {
      const error = refusal({ ...VALUES, allowFrom: value });
      expect(error.code).toBe("invalid_config");
      expect(error.message).toContain("allowFrom");
    },
  );
});
