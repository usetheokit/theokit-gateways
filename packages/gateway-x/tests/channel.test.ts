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

const required = xChannel.config.filter((f) => f.required);
const secrets = xChannel.config.filter((f) => f.secret);
const secretValues = secrets.map((f) => VALUES[f.key] as string).sort();
const prefixed = (name: string | undefined) => `APP_${name}`;
const reject = (source: Record<string, string>) => {
  const env = configFromEnv(descriptor, source, "APP_");
  const result = createChannels([{ descriptor, config: env.config, envPrefix: "APP_" }]);
  return { env, result };
};

describe("xChannel", () => {
  it("builds the adapter through createChannels from configFromEnv", () => {
    const { env, result } = reject(ENV);
    expect(env.missing).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(XAdapter);
  });

  it.each(required.map((f) => [prefixed(f.env)]))(
    "a missing %s is rejected naming the full variable",
    (name) => {
      const source = { ...ENV };
      delete source[name as string];
      const { env, result } = reject(source);
      expect(env.missing).toEqual([name]);
      expect(result.rejected[0]?.error.code).toBe("missing_required_config");
      expect(result.rejected[0]?.error.message).toContain(name);
    },
  );

  it("lists exactly the secret values in configFromEnv(...).secrets", () => {
    expect([...configFromEnv(descriptor, ENV, "APP_").secrets].sort()).toEqual(secretValues);
  });

  it.each(required.map((f) => [f.key]))("refuses a wrongly typed %s with invalid_config", (key) => {
    const error = refusal({ ...VALUES, [key as string]: { not: "valid" } });
    expect(error).toBeInstanceOf(GatewayConfigurationError);
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain(key);
  });

  it.each([null, 5, true, {}])("refuses a non-string bearerToken %j with invalid_config", (value) => {
    const error = refusal({ ...VALUES, bearerToken: value });
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain("bearerToken");
  });

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
