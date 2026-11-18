/** `googleChatChannel` — the Google Chat channel described as data, with env bindings. */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type ChannelDescriptor,
  configFromEnv,
  createChannels,
  GatewayConfigurationError,
  selectVariant,
} from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { GoogleChatAdapter } from "../src/adapter.js";
import { googleChatChannel } from "../src/channel.js";

const descriptor = googleChatChannel as unknown as ChannelDescriptor;

const ENV = {
  APP_GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL: "bot@proj.iam.gserviceaccount.com",
  APP_GOOGLE_CHAT_PRIVATE_KEY: "pem-key",
  APP_GOOGLE_CHAT_AUDIENCE: "https://example.com/google-chat",
};

function keyFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "gchat-"));
  const path = join(dir, "key.json");
  writeFileSync(path, content);
  return path;
}

function errorOf(fn: () => unknown): GatewayConfigurationError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GatewayConfigurationError);
    return err as GatewayConfigurationError;
  }
  throw new Error("expected a GatewayConfigurationError");
}

describe("googleChatChannel", () => {
  it("builds the adapter through createChannels from configFromEnv", () => {
    const env = configFromEnv(descriptor, ENV, "APP_");
    expect(env.missing).toEqual([]);
    const result = createChannels([{ descriptor, config: env.config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(GoogleChatAdapter);
  });

  it("a missing audience variable is reported by name", () => {
    const source: Record<string, string> = { ...ENV };
    delete source.APP_GOOGLE_CHAT_AUDIENCE;
    const env = configFromEnv(descriptor, source, "APP_");
    expect(env.missing).toEqual(["APP_GOOGLE_CHAT_AUDIENCE"]);
    const result = createChannels([{ descriptor, config: env.config, envPrefix: "APP_" }]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain("APP_GOOGLE_CHAT_AUDIENCE");
  });

  it("lists exactly the secret values in configFromEnv(...).secrets", () => {
    const env = configFromEnv(descriptor, ENV, "APP_");
    expect(env.secrets).toEqual(["pem-key"]);
    const secretKeys = googleChatChannel.config.filter((f) => f.secret).map((f) => f.key);
    expect(secretKeys).toEqual(["privateKey"]);
  });

  it("reads client_email and private_key from serviceAccountFile", () => {
    const path = keyFile(JSON.stringify({ client_email: "a@b.c", private_key: "k" }));
    const fileDescriptor = selectVariant(descriptor, "file");
    const env = configFromEnv(
      fileDescriptor,
      {
        APP_GOOGLE_CHAT_SERVICE_ACCOUNT_FILE: path,
        APP_GOOGLE_CHAT_AUDIENCE: "https://example.com/x",
      },
      "APP_",
    );
    expect(env.missing).toEqual([]);
    const result = createChannels([{ descriptor: fileDescriptor, config: env.config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(GoogleChatAdapter);
  });

  it.each([
    ["APP_GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL", "serviceAccountEmail"],
    ["APP_GOOGLE_CHAT_PRIVATE_KEY", "privateKey"],
  ])("a missing %s is missing_required_config, not invalid_config", (name) => {
    const source: Record<string, string> = { ...ENV };
    delete source[name];
    const env = configFromEnv(descriptor, source, "APP_");
    expect(env.missing).toEqual([name]);
    const result = createChannels([{ descriptor, config: env.config, envPrefix: "APP_" }]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain(name);
  });

  it("the file variant keeps inline credentials optional and collects the inline key as secret", () => {
    const fileDescriptor = selectVariant(descriptor, "file");
    const path = keyFile(JSON.stringify({ client_email: "a@b.c", private_key: "file-key" }));
    const env = configFromEnv(
      fileDescriptor,
      {
        APP_GOOGLE_CHAT_SERVICE_ACCOUNT_FILE: path,
        APP_GOOGLE_CHAT_AUDIENCE: "https://example.com/x",
        APP_GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL: "inline@b.c",
        APP_GOOGLE_CHAT_PRIVATE_KEY: "inline-key",
      },
      "APP_",
    );
    expect(env.missing).toEqual([]);
    expect(env.config.serviceAccountEmail).toBe("inline@b.c");
    expect(env.secrets).toEqual(["inline-key"]);
    const result = createChannels([{ descriptor: fileDescriptor, config: env.config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(GoogleChatAdapter);
  });

  it("the file variant requires APP_GOOGLE_CHAT_SERVICE_ACCOUNT_FILE", () => {
    const fileDescriptor = selectVariant(descriptor, "file");
    const env = configFromEnv(
      fileDescriptor,
      { APP_GOOGLE_CHAT_AUDIENCE: "https://example.com/x" },
      "APP_",
    );
    expect(env.missing).toEqual(["APP_GOOGLE_CHAT_SERVICE_ACCOUNT_FILE"]);
    const result = createChannels([
      { descriptor: fileDescriptor, config: env.config, envPrefix: "APP_" },
    ]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain("APP_GOOGLE_CHAT_SERVICE_ACCOUNT_FILE");
  });

  it("names the file when it cannot be read or lacks the fields", () => {
    const base = { audience: "https://example.com/x" };
    const missing = join(tmpdir(), "gchat-does-not-exist.json");
    for (const path of [missing, keyFile("not json"), keyFile(JSON.stringify({ a: 1 }))]) {
      const error = errorOf(() => googleChatChannel.create({ ...base, serviceAccountFile: path }));
      expect(error.code).toBe("invalid_config");
      expect(error.message).toContain(path);
    }
  });

  it("requires a credential source", () => {
    const error = errorOf(() => googleChatChannel.create({ audience: "https://x" }));
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain("serviceAccountEmail");
  });

  it("builds with webhook external only when asked", () => {
    const config = { audience: "https://x", serviceAccountEmail: "a@b.c", privateKey: "k" };
    expect(googleChatChannel.create({ ...config, webhook: "external" })).toBeInstanceOf(
      GoogleChatAdapter,
    );
    const error = errorOf(() => googleChatChannel.create({ ...config, webhook: "other" }));
    expect(error.message).toContain("webhook");
  });

  it.each([
    ["audience", { audience: 1, serviceAccountEmail: "a", privateKey: "k" }],
    ["serviceAccountEmail", { audience: "u", serviceAccountEmail: 1, privateKey: "k" }],
    ["privateKey", { audience: "u", serviceAccountEmail: "a", privateKey: 2 }],
    ["serviceAccountFile", { audience: "u", serviceAccountFile: 3 }],
    ["webhook", { audience: "u", serviceAccountEmail: "a", privateKey: "k", webhook: 4 }],
  ])("refuses a wrongly typed %s with invalid_config", (key, config) => {
    const error = errorOf(() => googleChatChannel.create(config));
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain(key);
  });
});
