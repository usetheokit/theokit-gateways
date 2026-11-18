import { describe, expect, it } from "vitest";

import type { ChannelDescriptor } from "../src/channel/channel-descriptor.js";
import { configFromEnv, selectVariant } from "../src/channel/config-from-env.js";
import { GatewayConfigurationError } from "../src/errors/config-error.js";
import { MockAdapter } from "./adapter/mock-adapter.js";

function make(config: ChannelDescriptor["config"], extra: object = {}): ChannelDescriptor {
  return {
    platform: "telegram",
    transport: "socket",
    config,
    create: () => new MockAdapter("telegram"),
    ...extra,
  } as ChannelDescriptor;
}

const field = (key: string, env: string | undefined, required: boolean, secret: boolean) => ({
  key,
  env,
  required,
  secret,
  description: key,
});

describe("configFromEnv", () => {
  it("trims a secret value and collects it", () => {
    const d = make([field("token", "X_TOKEN", true, true)]);
    const r = configFromEnv(d, { APP_X_TOKEN: " abc \n" }, "APP_");
    expect(r.config.token).toBe("abc");
    expect(r.missing).toEqual([]);
    expect(r.secrets).toEqual(["abc"]);
  });

  it("reports unset, empty and blank required variables by full name only", () => {
    const d = make([
      field("a", "A", true, true),
      field("b", "B", true, true),
      field("c", "C", true, true),
    ]);
    const r = configFromEnv(d, { P_B: "", P_C: "  \n" }, "P_");
    expect(r.missing).toEqual(["P_A", "P_B", "P_C"]);
    expect(r.config).toEqual({});
    expect(r.secrets).toEqual([]);
  });

  it("keeps a non-secret value out of secrets and skips fields without env", () => {
    const d = make([field("flag", "FLAG", false, false), field("x", undefined, true, true)]);
    const r = configFromEnv(d, { FLAG: "1", x: "no" });
    expect(r.config).toEqual({ flag: "1" });
    expect(r.secrets).toEqual([]);
    expect(r.missing).toEqual([]);
  });
});

describe("selectVariant", () => {
  const cloud = make([]);
  const d = make([], { variants: { cloud } });

  it("returns the descriptor or the named variant", () => {
    const plain = make([]);
    expect(selectVariant(plain, undefined)).toBe(plain);
    expect(selectVariant(d, "cloud")).toBe(cloud);
  });

  it("throws unknown_channel_variant listing the names", () => {
    try {
      selectVariant(d, "nope");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(GatewayConfigurationError);
      expect((e as GatewayConfigurationError).code).toBe("unknown_channel_variant");
      expect((e as Error).message).toContain("cloud");
    }
  });

  it("throws unknown_channel_variant when no name is given but variants exist", () => {
    expect(() => selectVariant(d, undefined)).toThrow(
      expect.objectContaining({ code: "unknown_channel_variant" }),
    );
  });

  it("throws platform_mismatch", () => {
    const bad = make([], { variants: { v: { ...cloud, platform: "slack" } } });
    expect(() => selectVariant(bad, "v")).toThrow(
      expect.objectContaining({ code: "platform_mismatch" }),
    );
  });
});

describe("configFromEnv with createChannels", () => {
  it("reports the same full variable names in both APIs", async () => {
    const { createChannels } = await import("../src/channel/create-channels.js");
    const d = make([
      field("token", "X_TOKEN", true, true),
      field("secret", "X_SECRET", true, true),
      field("label", undefined, true, false),
    ]);
    const env = configFromEnv(d, {}, "APP_");
    const { rejected } = createChannels([{ descriptor: d, config: env.config, envPrefix: "APP_" }]);
    const message = rejected[0]?.error.message ?? "";
    expect(env.missing).toEqual(["APP_X_TOKEN", "APP_X_SECRET"]);
    for (const name of env.missing) expect(message).toContain(`(env ${name})`);
    expect(message).toContain("label");
    expect(message).not.toContain("label (env");
  });
});
