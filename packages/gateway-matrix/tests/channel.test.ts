import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { MatrixAdapter } from "../src/adapter.js";
import { matrixChannel } from "../src/channel.js";

const ENV: Record<string, string> = {
  APP_MATRIX_HOMESERVER_URL: "https://matrix.example.org",
  APP_MATRIX_ACCESS_TOKEN: "syt_secret",
  APP_MATRIX_USER_ID: "@bot:example.org",
};

describe("matrixChannel", () => {
  it("builds the adapter from configFromEnv with every required variable set", () => {
    const { config, missing } = configFromEnv(matrixChannel, ENV, "APP_");
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: matrixChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(MatrixAdapter);
  });

  for (const field of matrixChannel.config.filter((f) => f.required && f.env !== undefined)) {
    it(`reports ${field.env} when it is unset`, () => {
      const env = { ...ENV };
      delete env[`APP_${field.env}`];
      const { config, missing } = configFromEnv(matrixChannel, env, "APP_");
      expect(missing).toEqual([`APP_${field.env}`]);
      const result = createChannels([{ descriptor: matrixChannel, config }]);
      expect(result.adapters).toEqual([]);
      expect(result.rejected[0]?.error).toMatchObject({ code: "missing_required_config" });
      expect(result.rejected[0]?.error.message).toContain(field.key);
      // createChannels (shared package) only knows config keys; the prefixed variable name is reported by configFromEnv.
      expect(missing[0]).toBe(`APP_${field.env}`);
    });
  }

  it("rejects a wrongly typed value with invalid_config naming the key", () => {
    const { config } = configFromEnv(matrixChannel, ENV, "APP_");
    expect(() => matrixChannel.create({ ...config, homeserverUrl: 42 })).toThrow(
      GatewayConfigurationError,
    );
    try {
      matrixChannel.create({ ...config, homeserverUrl: 42 });
    } catch (err) {
      expect((err as GatewayConfigurationError).code).toBe("invalid_config");
      expect((err as Error).message).toContain("homeserverUrl");
    }
  });

  it("rejects a malformed boolean and number", () => {
    const { config } = configFromEnv(matrixChannel, ENV, "APP_");
    expect(() => matrixChannel.create({ ...config, requireMention: "yes" })).toThrow(
      /requireMention/,
    );
    expect(() => matrixChannel.create({ ...config, requireMention: "true" })).not.toThrow();
  });

  it("lists exactly the secret fields in configFromEnv(...).secrets", () => {
    const all = { ...ENV };
    for (const f of matrixChannel.config) if (f.env !== undefined) all[`APP_${f.env}`] ??= "1";
    const { secrets } = configFromEnv(matrixChannel, all, "APP_");
    const expected = matrixChannel.config
      .filter((f) => f.secret && f.env !== undefined)
      .map((f) => all[`APP_${f.env}`]);
    expect(secrets).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });
});

describe("matrixChannel null and overflow", () => {
  it("rejects null for a supplied optional value instead of treating it as absent", () => {
    const { config } = configFromEnv(matrixChannel, ENV, "APP_");
    for (const key of ["requireMention", "freshnessWindowMs", "acceptInvite"]) {
      expect(() => matrixChannel.create({ ...config, [key]: null })).toThrow(new RegExp(key));
    }
  });

  it("rejects a digit string that overflows to Infinity", () => {
    const { config } = configFromEnv(matrixChannel, ENV, "APP_");
    expect(() => matrixChannel.create({ ...config, freshnessWindowMs: "9".repeat(400) })).toThrow(
      /freshnessWindowMs/,
    );
  });
});
