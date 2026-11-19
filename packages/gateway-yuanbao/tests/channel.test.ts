import {
  configFromEnv,
  createChannels,
  GatewayConfigurationError,
} from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { YuanbaoAdapter } from "../src/adapter.js";
import { yuanbaoChannel } from "../src/channel.js";

const REQUIRED = [
  { variable: "APP_YUANBAO_APP_ID", key: "appId", value: "ybid" },
  {
    variable: "APP_YUANBAO_APP_SECRET",
    key: "appSecret",
    value: "yb-app-secret",
  },
  {
    variable: "APP_YUANBAO_CALLBACK_SECRET",
    key: "callbackSecret",
    value: "yb-cb-secret",
  },
];
const envWithout = (skip?: string) =>
  Object.fromEntries(
    REQUIRED.filter((r) => r.variable !== skip).map((r) => [
      r.variable,
      r.value,
    ]),
  );

describe("yuanbaoChannel", () => {
  it("builds the adapter from the environment through createChannels", () => {
    const { config } = configFromEnv(yuanbaoChannel, envWithout(), "APP_");
    const built = createChannels([{ descriptor: yuanbaoChannel, config }]);
    expect(built.rejected).toEqual([]);
    expect(built.adapters[0]).toBeInstanceOf(YuanbaoAdapter);
    expect(yuanbaoChannel.transport).toBe("webhook");
  });

  it.each(REQUIRED)(
    "names $key as missing_required_config when $variable is unset",
    (entry) => {
      const read = configFromEnv(
        yuanbaoChannel,
        envWithout(entry.variable),
        "APP_",
      );
      expect(read.missing).toEqual([entry.variable]);
      const [rejection] = createChannels([
        { descriptor: yuanbaoChannel, config: read.config },
      ]).rejected;
      expect(rejection?.error.code).toBe("missing_required_config");
      expect(rejection?.error.message).toContain(entry.key);
    },
  );

  it("refuses a number for appSecret with invalid_config naming the key", () => {
    const { config } = configFromEnv(yuanbaoChannel, envWithout(), "APP_");
    const build = () => yuanbaoChannel.create({ ...config, appSecret: 42 });
    expect(build).toThrow(GatewayConfigurationError);
    expect(build).toThrow(
      expect.objectContaining({
        code: "invalid_config",
        message: expect.stringContaining("appSecret"),
      }),
    );
  });

  it("collects exactly the secret values", () => {
    const { secrets } = configFromEnv(yuanbaoChannel, envWithout(), "APP_");
    expect([...secrets].sort()).toEqual(["yb-app-secret", "yb-cb-secret"]);
  });
});
