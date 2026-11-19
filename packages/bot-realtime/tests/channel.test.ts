import { GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { realtimeBotChannel } from "../src/index.js";

const channel = realtimeBotChannel("gateway-x", "x", "X", (options) => options);
const BASE = { baseUrl: "https://x", token: "t", workspaceId: "w", botUserId: "b" };

function messageOf(config: Record<string, unknown>): string {
  try {
    channel.create(config);
  } catch (err) {
    expect(err).toBeInstanceOf(GatewayConfigurationError);
    expect((err as GatewayConfigurationError).code).toBe("invalid_config");
    return (err as Error).message;
  }
  throw new Error("nothing was thrown");
}

describe("realtimeBotChannel", () => {
  it("binds each key to PLATFORM_KEY and marks only the token secret", () => {
    expect(channel.config.map((f) => f.env)).toEqual([
      "X_BASE_URL",
      "X_TOKEN",
      "X_WORKSPACE_ID",
      "X_BOT_USER_ID",
      "X_RECONNECT_DELAY_MS",
    ]);
    expect(channel.config.filter((f) => f.secret).map((f) => f.key)).toEqual(["token"]);
  });

  it.each([null, "soon", "9".repeat(400), -1])("refuses reconnectDelayMs %s", (value) => {
    expect(messageOf({ ...BASE, reconnectDelayMs: value })).toContain("reconnectDelayMs");
  });

  it("accepts a number or a digit string for reconnectDelayMs", () => {
    expect(channel.create({ ...BASE, reconnectDelayMs: "250" }).reconnectDelayMs).toBe(250);
    expect(channel.create({ ...BASE, reconnectDelayMs: 0 }).reconnectDelayMs).toBe(0);
  });
});
