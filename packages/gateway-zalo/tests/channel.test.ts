import {
  configFromEnv,
  createChannels,
  GatewayConfigurationError,
} from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { ZaloAdapter } from "../src/adapter.js";
import { zaloChannel } from "../src/channel.js";

const ENV: Record<string, string> = {
  APP_ZALO_APP_ID: "zid",
  APP_ZALO_OA_SECRET_KEY: "zalo-oa-key",
  APP_ZALO_ACCESS_TOKEN: "zalo-token",
};
const KEY_OF: Record<string, string> = {
  APP_ZALO_APP_ID: "appId",
  APP_ZALO_OA_SECRET_KEY: "oaSecretKey",
  APP_ZALO_ACCESS_TOKEN: "accessToken",
};
const fromEnv = (env: Record<string, string>) =>
  configFromEnv(zaloChannel, env, "APP_");

describe("zaloChannel", () => {
  it("builds the adapter from the environment via createChannels", () => {
    const out = createChannels([
      { descriptor: zaloChannel, config: fromEnv(ENV).config },
    ]);
    expect(out.rejected).toEqual([]);
    expect(out.adapters[0]).toBeInstanceOf(ZaloAdapter);
    expect(zaloChannel.transport).toBe("webhook");
  });

  it.each(Object.keys(ENV))(
    "rejects with missing_required_config when %s is unset",
    (name) => {
      const env = Object.fromEntries(
        Object.entries(ENV).filter(([k]) => k !== name),
      );
      const partial = fromEnv(env);
      expect(partial.missing).toEqual([name]);
      const { rejected } = createChannels([
        { descriptor: zaloChannel, config: partial.config },
      ]);
      expect(rejected[0]?.error.code).toBe("missing_required_config");
      expect(rejected[0]?.error.message).toContain(KEY_OF[name]);
    },
  );

  it("refuses a number for oaSecretKey with invalid_config naming the key", () => {
    const build = () =>
      zaloChannel.create({ ...fromEnv(ENV).config, oaSecretKey: 42 });
    expect(build).toThrow(GatewayConfigurationError);
    expect(build).toThrow(
      expect.objectContaining({
        code: "invalid_config",
        message: expect.stringContaining("oaSecretKey"),
      }),
    );
  });

  it("collects exactly the secret values", () => {
    expect([...fromEnv(ENV).secrets].sort()).toEqual([
      "zalo-oa-key",
      "zalo-token",
    ]);
  });
});
