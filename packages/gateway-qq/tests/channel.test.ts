import {
  configFromEnv,
  createChannels,
  GatewayConfigurationError,
} from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { QQAdapter } from "../src/adapter.js";
import { qqChannel } from "../src/channel.js";

const ENV = { APP_QQ_APP_ID: "app-1", APP_QQ_APP_SECRET: "s3cret-qq" };
const read = (env: Record<string, string>) =>
  configFromEnv(qqChannel, env, "APP_");

describe("qqChannel", () => {
  it("builds the adapter from the environment through createChannels", () => {
    const result = createChannels([
      { descriptor: qqChannel, config: read(ENV).config },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(QQAdapter);
    expect(qqChannel.transport).toBe("webhook");
  });

  it("rejects with missing_required_config naming the unset key", () => {
    for (const [name, key] of [
      ["APP_QQ_APP_ID", "appId"],
      ["APP_QQ_APP_SECRET", "appSecret"],
    ] as const) {
      const env = Object.fromEntries(Object.entries(ENV).filter(([k]) => k !== name));
      const partial = read(env);
      expect(partial.missing).toEqual([name]);
      const [rejection] = createChannels([
        { descriptor: qqChannel, config: partial.config },
      ]).rejected;
      expect(rejection?.error.code).toBe("missing_required_config");
      expect(rejection?.error.message).toContain(key);
    }
  });

  it("refuses a number for appSecret with invalid_config naming the key", () => {
    const build = () =>
      qqChannel.create({ ...read(ENV).config, appSecret: 42 });
    expect(build).toThrow(GatewayConfigurationError);
    expect(build).toThrow(
      expect.objectContaining({
        code: "invalid_config",
        message: expect.stringContaining("appSecret"),
      }),
    );
  });

  it("collects exactly the secret values", () => {
    expect([...read(ENV).secrets]).toEqual(["s3cret-qq"]);
  });
});
