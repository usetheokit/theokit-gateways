import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { ZaloAdapter } from "../src/adapter.js";
import { zaloChannel } from "../src/channel.js";

const ENV = {
  APP_ZALO_APP_ID: "zid",
  APP_ZALO_OA_SECRET_KEY: "zalo-oa-key",
  APP_ZALO_ACCESS_TOKEN: "zalo-token",
};
const KEYS: Record<string, string> = {
  APP_ZALO_APP_ID: "appId",
  APP_ZALO_OA_SECRET_KEY: "oaSecretKey",
  APP_ZALO_ACCESS_TOKEN: "accessToken",
};

describe("zaloChannel", () => {
  it("builds the adapter from the environment through createChannels", () => {
    const { config } = configFromEnv(zaloChannel, ENV, "APP_");
    const result = createChannels([{ descriptor: zaloChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(ZaloAdapter);
  });

  it("binds ZALO_* variables and is a webhook channel", () => {
    expect(zaloChannel.platform).toBe("zalo");
    expect(zaloChannel.transport).toBe("webhook");
    expect(zaloChannel.config.filter((f) => f.required).map((f) => f.env)).toEqual([
      "ZALO_APP_ID",
      "ZALO_OA_SECRET_KEY",
      "ZALO_ACCESS_TOKEN",
    ]);
  });

  it.each(Object.keys(ENV))("rejects with missing_required_config when %s is unset", (name) => {
    const env: Record<string, string> = { ...ENV };
    delete env[name];
    const read = configFromEnv(zaloChannel, env, "APP_");
    expect(read.missing).toEqual([name]);
    const result = createChannels([{ descriptor: zaloChannel, config: read.config }]);
    expect(result.adapters).toEqual([]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain(KEYS[name]);
  });

  it("refuses a number for oaSecretKey with invalid_config naming the key", () => {
    const { config } = configFromEnv(zaloChannel, ENV, "APP_");
    expect(() => zaloChannel.create({ ...config, oaSecretKey: 42 })).toThrow(
      expect.objectContaining({
        code: "invalid_config",
        message: expect.stringContaining("oaSecretKey"),
      }),
    );
    expect(() => zaloChannel.create({ ...config, oaSecretKey: 42 })).toThrow(
      GatewayConfigurationError,
    );
  });

  it("collects exactly the secret values", () => {
    const { secrets } = configFromEnv(zaloChannel, ENV, "APP_");
    expect([...secrets].sort()).toEqual(["zalo-oa-key", "zalo-token"]);
  });
});
