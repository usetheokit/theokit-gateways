/**
 * `imessageChannel` — the iMessage channel described as data, bound to environment variables.
 */

import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IMessageAdapter } from "../src/adapter.js";
import { imessageChannel } from "../src/channel.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function errorOf(fn: () => unknown): GatewayConfigurationError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GatewayConfigurationError);
    return err as GatewayConfigurationError;
  }
  throw new Error("expected a configuration error");
}

const ENV = {
  APP_IMESSAGE_CLI_PATH: "/opt/imsg",
  APP_IMESSAGE_DB_PATH: "/tmp/chat.db",
  APP_IMESSAGE_REQUEST_TIMEOUT_MS: "5000",
};

const REAL_PLATFORM = Object.getOwnPropertyDescriptor(process, "platform");

function onPlatform(name: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: name, configurable: true });
}

describe("imessageChannel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (REAL_PLATFORM) Object.defineProperty(process, "platform", REAL_PLATFORM);
  });

  it("declares a socket transport and env names", () => {
    expect(imessageChannel.platform).toBe("imessage");
    expect(imessageChannel.transport).toBe("socket");
    expect(imessageChannel.config.map((f) => f.env)).toEqual(
      expect.arrayContaining(["IMESSAGE_CLI_PATH", "IMESSAGE_DB_PATH"]),
    );
  });

  it("builds the adapter from configFromEnv on darwin", () => {
    onPlatform("darwin");
    const { config, missing } = configFromEnv(imessageChannel, ENV, "APP_");
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: imessageChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(IMessageAdapter);
  });

  it("has no required variable, so an empty environment builds on darwin", () => {
    onPlatform("darwin");
    const { config, missing } = configFromEnv(imessageChannel, {}, "APP_");
    expect(missing).toEqual([]);
    expect(createChannels([{ descriptor: imessageChannel, config }]).adapters).toHaveLength(1);
  });

  it("rejects other platforms with invalid_config naming the platform", () => {
    onPlatform("linux");
    const error = errorOf(() => imessageChannel.create({}));
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain("linux");
    const result = createChannels([{ descriptor: imessageChannel, config: {} }]);
    expect(result.rejected[0]?.error.code).toBe("invalid_config");
  });

  it("collects no secrets: no field is secret", () => {
    expect(imessageChannel.config.filter((f) => f.secret)).toEqual([]);
    expect(configFromEnv(imessageChannel, ENV, "APP_").secrets).toEqual([]);
  });

  it("rejects wrongly typed values naming the key", () => {
    onPlatform("darwin");
    for (const [key, value] of [
      ["cliPath", 1],
      ["dbPath", true],
      ["connectTimeoutMs", "soon"],
      ["requestTimeoutMs", {}],
    ] as const) {
      const error = errorOf(() => imessageChannel.create({ [key]: value }));
      expect(error.code).toBe("invalid_config");
      expect(error.message).toContain(key);
    }
  });

  it("rejects a digit string too long to be a finite number", () => {
    onPlatform("darwin");
    const error = errorOf(() => imessageChannel.create({ requestTimeoutMs: "9".repeat(400) }));
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain("requestTimeoutMs");
  });

  it("rejects null for an optional value, naming the key", () => {
    onPlatform("darwin");
    for (const key of ["cliPath", "requestTimeoutMs"]) {
      const error = errorOf(() => imessageChannel.create({ [key]: null }));
      expect(error.code).toBe("invalid_config");
      expect(error.message).toContain(key);
    }
  });
});
