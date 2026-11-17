/** `whatsappChannel` — the WhatsApp channel described as data, with env bindings and variants. */

import {
  type ChannelDescriptor,
  configFromEnv,
  createChannels,
  GatewayConfigurationError,
  selectVariant,
} from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { WhatsAppAdapter } from "../src/adapter.js";
import { whatsappChannel } from "../src/channel.js";
import { ConfigurationError } from "../src/errors.js";

const descriptor = (name: string): ChannelDescriptor =>
  selectVariant(whatsappChannel as unknown as ChannelDescriptor, name);

const CLOUD_ENV = {
  APP_WHATSAPP_ACCESS_TOKEN: "tok-1",
  APP_WHATSAPP_PHONE_NUMBER_ID: "123456",
  APP_WHATSAPP_APP_SECRET: "sec-1",
  APP_WHATSAPP_VERIFY_TOKEN: "ver-1",
};

describe("whatsappChannel", () => {
  it("builds the cloud adapter through createChannels from configFromEnv", () => {
    const cloud = descriptor("cloud");
    const env = configFromEnv(cloud, CLOUD_ENV, "APP_");
    expect(env.missing).toEqual([]);
    const result = createChannels([{ descriptor: cloud, config: env.config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(WhatsAppAdapter);
  });

  it("builds the baileys adapter from configFromEnv", () => {
    const baileys = descriptor("baileys");
    const env = configFromEnv(baileys, { APP_WHATSAPP_SESSION_DIR: "/tmp/wa" }, "APP_");
    const result = createChannels([{ descriptor: baileys, config: env.config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(WhatsAppAdapter);
    expect(env.secrets).toEqual([]);
  });

  it("the parent descriptor is the cloud shape", () => {
    const result = createChannels([
      {
        descriptor: whatsappChannel as unknown as ChannelDescriptor,
        config: configFromEnv(whatsappChannel as unknown as ChannelDescriptor, CLOUD_ENV, "APP_")
          .config,
      },
    ]);
    expect(result.rejected).toEqual([]);
  });

  it.each([
    ["cloud", "APP_WHATSAPP_ACCESS_TOKEN", "accessToken"],
    ["cloud", "APP_WHATSAPP_PHONE_NUMBER_ID", "phoneNumberId"],
    ["cloud", "APP_WHATSAPP_APP_SECRET", "appSecret"],
    ["baileys", "APP_WHATSAPP_SESSION_DIR", "sessionDir"],
  ])("a missing %s variable %s is reported by name", (variant, name, key) => {
    const d = descriptor(variant);
    const source: Record<string, string> = {
      ...CLOUD_ENV,
      APP_WHATSAPP_SESSION_DIR: "/tmp/wa",
    };
    delete source[name];
    const env = configFromEnv(d, source, "APP_");
    expect(env.missing).toEqual([name]);
    const result = createChannels([{ descriptor: d, config: env.config }]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain(key);
  });

  it("lists exactly the secret values in configFromEnv(...).secrets", () => {
    const env = configFromEnv(descriptor("cloud"), CLOUD_ENV, "APP_");
    expect(env.secrets.toSorted()).toEqual(["sec-1", "tok-1", "ver-1"]);
    expect(whatsappChannel.variants.cloud.config.filter((f) => f.secret).map((f) => f.key)).toEqual(
      ["accessToken", "appSecret", "verifyToken"],
    );
    expect(whatsappChannel.variants.baileys.config.some((f) => f.secret)).toBe(false);
  });

  it("names the key of a wrongly typed value", () => {
    for (const [variant, config] of [
      ["cloud", { accessToken: 42, phoneNumberId: "1", appSecret: "s" }],
      ["cloud", { accessToken: "t", phoneNumberId: "1", appSecret: "s", verifyToken: 7 }],
      ["baileys", { sessionDir: 5 }],
      ["baileys", { sessionDir: "/x", requireMention: "maybe" }],
    ] as const) {
      let error: unknown;
      try {
        descriptor(variant).create(config);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(error).toBeInstanceOf(GatewayConfigurationError);
      expect((error as ConfigurationError).code).toBe("invalid_config");
      expect((error as ConfigurationError).message).toContain(
        (error as ConfigurationError).detail as string,
      );
    }
  });

  it("accepts requireMention as the string false", () => {
    const adapter = descriptor("baileys").create({ sessionDir: "/x", requireMention: "false" });
    expect(adapter).toBeInstanceOf(WhatsAppAdapter);
  });

  it("uses the env names of the convention", () => {
    expect(whatsappChannel.variants.cloud.config.map((f) => f.env)).toEqual([
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_APP_SECRET",
      "WHATSAPP_VERIFY_TOKEN",
      "WHATSAPP_REQUIRE_MENTION",
    ]);
    expect(whatsappChannel.variants.baileys.config[0]?.env).toBe("WHATSAPP_SESSION_DIR");
  });
});
