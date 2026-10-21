/**
 * `telegramChannel` — the Telegram channel described as data (FR-004; alignment AC-004).
 */

import { GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { TelegramAdapter } from "../src/adapter.js";
import { telegramChannel } from "../src/channel.js";
import { ConfigurationError } from "../src/errors.js";

/** The ConfigurationError `fn` throws, or a failure naming what was thrown instead. */
function configurationErrorOf(fn: () => unknown): ConfigurationError {
  try {
    fn();
  } catch (err) {
    expect(err, "threw something that is not a ConfigurationError").toBeInstanceOf(
      ConfigurationError,
    );
    return err as ConfigurationError;
  }
  throw new Error("expected a ConfigurationError, nothing was thrown");
}

describe("telegramChannel", () => {
  it("marks the token field required and secret", () => {
    expect(telegramChannel.config).toContainEqual(
      expect.objectContaining({ key: "token", required: true, secret: true }),
    );
    expect(telegramChannel.config).toContainEqual(
      expect.objectContaining({ key: "allowedUsers", required: false, secret: false }),
    );
  });

  it("builds a TelegramAdapter from a token", () => {
    expect(telegramChannel.create({ token: "123:abc" })).toBeInstanceOf(TelegramAdapter);
  });

  it("declares socket transport and no webhook part", () => {
    expect(telegramChannel.platform).toBe("telegram");
    expect(telegramChannel.transport).toBe("socket");
    expect("webhook" in telegramChannel).toBe(false);
  });

  it("refuses a token that is not a string", () => {
    const error = configurationErrorOf(() => telegramChannel.create({ token: 42 }));
    expect(error).toBeInstanceOf(GatewayConfigurationError);
    expect(error.code).toBe("invalid_config");
    expect(error.detail).toBe("token");
    expect(error.message).toContain("token");
  });

  it("refuses an empty token", () => {
    const error = configurationErrorOf(() => telegramChannel.create({ token: "" }));
    expect(error).toBeInstanceOf(GatewayConfigurationError);
    expect(error.code).toBe("token_required");
    expect(error.detail).toBe("token");
  });

  it("refuses allowedUsers that is not an array of strings", () => {
    expect(
      configurationErrorOf(() => telegramChannel.create({ token: "1:a", allowedUsers: "42" }))
        .detail,
    ).toBe("allowedUsers");
    expect(
      configurationErrorOf(() => telegramChannel.create({ token: "1:a", allowedUsers: [42] }))
        .detail,
    ).toBe("allowedUsers");
  });

  it("treats a null allowedUsers as absent", () => {
    expect(telegramChannel.create({ token: "1:a", allowedUsers: null })).toBeInstanceOf(
      TelegramAdapter,
    );
  });
});

describe("gateway-telegram ConfigurationError", () => {
  it("has name, code, and default prefixed message", () => {
    const e = new ConfigurationError({ code: "token_required" });
    expect(e.name).toBe("ConfigurationError");
    expect(e.code).toBe("token_required");
    expect(e.message).toBe("gateway-telegram: token_required");
    expect(e).toBeInstanceOf(GatewayConfigurationError);
  });
});
