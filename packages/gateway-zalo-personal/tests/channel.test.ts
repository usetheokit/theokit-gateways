import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { ZaloPersonalAdapter } from "../src/adapter.js";
import { zaloPersonalChannel } from "../src/channel.js";

const CREDENTIALS = { cookie: [], imei: "imei-1", userAgent: "ua" };
const JSON_TEXT = JSON.stringify(CREDENTIALS);
const ENV = { APP_ZALO_PERSONAL_CREDENTIALS: JSON_TEXT };

function errorOf(fn: () => unknown): GatewayConfigurationError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GatewayConfigurationError);
    return err as GatewayConfigurationError;
  }
  throw new Error("nothing was thrown");
}

describe("zaloPersonalChannel", () => {
  it("builds the adapter through createChannels from configFromEnv", () => {
    const { config, missing } = configFromEnv(zaloPersonalChannel, ENV, "APP_");
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: zaloPersonalChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(ZaloPersonalAdapter);
  });

  it("rejects with missing_required_config when the variable is unset", () => {
    const { config, missing } = configFromEnv(zaloPersonalChannel, {}, "APP_");
    expect(missing).toEqual(["APP_ZALO_PERSONAL_CREDENTIALS"]);
    expect(missing[0]).toBe("APP_ZALO_PERSONAL_CREDENTIALS");
    const { rejected } = createChannels([{ descriptor: zaloPersonalChannel, config }]);
    expect(rejected[0]?.error.code).toBe("missing_required_config");
    expect(rejected[0]?.error.message).toContain("credentials");
    // The factory message names the config key; the descriptor binds that key to the full variable.
    const field = zaloPersonalChannel.config.find((f) => f.key === "credentials");
    expect(missing).toContain(`APP_${field?.env}`);
    expect(`APP_${field?.env}`).toBe(missing[0]);

    // The factory names the keys of the descriptor it is given; keyed by full variable, it names those.
    const byVariable = {
      ...zaloPersonalChannel,
      config: zaloPersonalChannel.config.map((f) => ({ ...f, key: `APP_${f.env}` })),
    };
    const named = createChannels([{ descriptor: byVariable, config: {} }]).rejected[0]?.error;
    expect(named?.code).toBe("missing_required_config");
    expect(named?.message).toContain(missing[0] as string);
  });

  it("accepts credentials as an object", () => {
    expect(zaloPersonalChannel.create({ credentials: CREDENTIALS })).toBeInstanceOf(
      ZaloPersonalAdapter,
    );
  });

  it.each([
    ["credentials", 42],
    ["credentials", "{not json"],
    ["credentials", "[]"],
    ["credentials", { cookie: [], imei: "", userAgent: "ua" }],
    ["credentials", { cookie: [], imei: "i", userAgent: 1 }],
    ["login", "x"],
    ["login", null],
  ])("throws invalid_config naming the key for %s = %j", (key, value) => {
    const error = errorOf(() =>
      zaloPersonalChannel.create({ credentials: CREDENTIALS, [key]: value }),
    );
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain(`config.${key}`);
    expect(error.message).toContain("gateway-zalo-personal");
  });

  it("reports exactly the secret fields in configFromEnv(...).secrets", () => {
    expect(configFromEnv(zaloPersonalChannel, ENV, "APP_").secrets).toEqual([JSON_TEXT]);
  });

  it("declares socket transport", () => {
    expect(zaloPersonalChannel.transport).toBe("socket");
  });
});
