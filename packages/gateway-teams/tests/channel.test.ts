/** `teamsChannel` — the Teams channel described as data, with env bindings. */

import {
  type ChannelDescriptor,
  configFromEnv,
  createChannels,
  GatewayConfigurationError,
} from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { TeamsAdapter } from "../src/adapter.js";
import { teamsChannel } from "../src/channel.js";

const descriptor = teamsChannel as unknown as ChannelDescriptor;

const ENV = {
  APP_TEAMS_CLIENT_ID: "client-1",
  APP_TEAMS_CLIENT_SECRET: "secret-1",
  APP_TEAMS_TENANT_ID: "tenant-1",
};

describe("teamsChannel", () => {
  it("builds the adapter through createChannels from configFromEnv", () => {
    const env = configFromEnv(descriptor, ENV, "APP_");
    expect(env.missing).toEqual([]);
    const result = createChannels([{ descriptor, config: env.config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(TeamsAdapter);
  });

  it.each([
    ["APP_TEAMS_CLIENT_ID", "clientId"],
    ["APP_TEAMS_CLIENT_SECRET", "clientSecret"],
    ["APP_TEAMS_TENANT_ID", "tenantId"],
  ])("a missing %s is reported by name", (name, key) => {
    const source: Record<string, string> = { ...ENV };
    delete source[name];
    const env = configFromEnv(descriptor, source, "APP_");
    expect(env.missing).toEqual([name]);
    const result = createChannels([{ descriptor, config: env.config }]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain(key);
  });

  it("lists exactly the secret values in configFromEnv(...).secrets", () => {
    const env = configFromEnv(descriptor, ENV, "APP_");
    expect(env.secrets).toEqual(["secret-1"]);
    const secretKeys = teamsChannel.config.filter((f) => f.secret).map((f) => f.key);
    expect(secretKeys).toEqual(["clientSecret"]);
  });

  it.each([
    ["clientId", { clientId: 1, clientSecret: "s", tenantId: "t" }],
    ["clientSecret", { clientId: "c", clientSecret: 2, tenantId: "t" }],
    ["tenantId", { clientId: "c", clientSecret: "s", tenantId: 3 }],
    ["botDisplayName", { clientId: "c", clientSecret: "s", tenantId: "t", botDisplayName: 4 }],
    ["requireMention", { clientId: "c", clientSecret: "s", tenantId: "t", requireMention: "no" }],
  ])("refuses a wrongly typed %s with invalid_config", (key, config) => {
    let error: unknown;
    try {
      teamsChannel.create(config);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(GatewayConfigurationError);
    expect((error as GatewayConfigurationError).code).toBe("invalid_config");
    expect((error as GatewayConfigurationError).message).toContain(key);
  });

  it("accepts requireMention as the string false", () => {
    const adapter = teamsChannel.create({
      clientId: "c",
      clientSecret: "s",
      tenantId: "t",
      requireMention: "false",
    });
    expect(adapter).toBeInstanceOf(TeamsAdapter);
  });
});
