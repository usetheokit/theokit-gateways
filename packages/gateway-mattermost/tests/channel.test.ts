import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { MattermostAdapter } from "../src/adapter.js";
import { mattermostChannel } from "../src/channel.js";

const ENV: Record<string, string> = {
  APP_MATTERMOST_BASE_URL: "https://mm.example.org",
  APP_MATTERMOST_ACCESS_TOKEN: "mm_secret",
};

describe("mattermostChannel", () => {
  it("builds the adapter from configFromEnv with every required variable set", () => {
    const { config, missing } = configFromEnv(mattermostChannel, ENV, "APP_");
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: mattermostChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(MattermostAdapter);
  });

  for (const field of mattermostChannel.config.filter((f) => f.required && f.env !== undefined)) {
    it(`reports ${field.env} when it is unset`, () => {
      const env = { ...ENV };
      delete env[`APP_${field.env}`];
      const { config, missing } = configFromEnv(mattermostChannel, env, "APP_");
      expect(missing).toEqual([`APP_${field.env}`]);
      const result = createChannels([{ descriptor: mattermostChannel, config }]);
      expect(result.adapters).toEqual([]);
      expect(result.rejected[0]?.error).toMatchObject({ code: "missing_required_config" });
      expect(result.rejected[0]?.error.message).toContain(field.key);
    });
  }

  it("rejects a wrongly typed value with invalid_config naming the key", () => {
    const { config } = configFromEnv(mattermostChannel, ENV, "APP_");
    expect(() => mattermostChannel.create({ ...config, baseUrl: 42 })).toThrow(
      GatewayConfigurationError,
    );
    try {
      mattermostChannel.create({ ...config, baseUrl: 42 });
    } catch (err) {
      expect((err as GatewayConfigurationError).code).toBe("invalid_config");
      expect((err as Error).message).toContain("baseUrl");
    }
  });

  it("rejects a malformed boolean and number", () => {
    const { config } = configFromEnv(mattermostChannel, ENV, "APP_");
    expect(() => mattermostChannel.create({ ...config, requireMention: "yes" })).toThrow(
      /requireMention/,
    );
    expect(() => mattermostChannel.create({ ...config, requireMention: "true" })).not.toThrow();
  });

  it("lists exactly the secret fields in configFromEnv(...).secrets", () => {
    const all = { ...ENV };
    for (const f of mattermostChannel.config) if (f.env !== undefined) all[`APP_${f.env}`] ??= "1";
    const { secrets } = configFromEnv(mattermostChannel, all, "APP_");
    const expected = mattermostChannel.config
      .filter((f) => f.secret && f.env !== undefined)
      .map((f) => all[`APP_${f.env}`]);
    expect(secrets).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });
});

describe("mattermostChannel null and overflow", () => {
  it("rejects null for a supplied optional value instead of treating it as absent", () => {
    const { config } = configFromEnv(mattermostChannel, ENV, "APP_");
    for (const key of ["requireMention"]) {
      expect(() => mattermostChannel.create({ ...config, [key]: null })).toThrow(new RegExp(key));
    }
  });
});
