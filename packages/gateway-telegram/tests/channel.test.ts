/**
 * `telegramChannel` — the Telegram channel described as data (FR-004; alignment AC-004).
 */

import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
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
  it("declares an authenticated sender", () => {
    expect(telegramChannel.senderIdentity).toBe("authenticated");
  });

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
      configurationErrorOf(() => telegramChannel.create({ token: "1:a", allowedUsers: 42 })).detail,
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

describe("telegramChannel env bindings", () => {
  const ENV = { APP_TELEGRAM_TOKEN: "123:secret" };

  it("builds the adapter from configFromEnv", () => {
    const { config, missing } = configFromEnv(telegramChannel, ENV, "APP_");
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: telegramChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(TelegramAdapter);
  });

  it("reports the unset variable, and createChannels rejects it", () => {
    const { config, missing } = configFromEnv(telegramChannel, {}, "APP_");
    expect(missing).toEqual(["APP_TELEGRAM_TOKEN"]);
    const result = createChannels([{ descriptor: telegramChannel, config, envPrefix: "APP_" }]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toBe(
      "channel telegram: missing required config token (env APP_TELEGRAM_TOKEN)",
    );
  });

  it("collects only secret values", () => {
    const env = { ...ENV, APP_TELEGRAM_ALLOWED_USERS: "1,2" };
    expect(configFromEnv(telegramChannel, env, "APP_").secrets).toEqual(["123:secret"]);
  });

  it("accepts a comma-separated list and boolean strings", () => {
    expect(
      telegramChannel.create({ token: "1:a", allowedUsers: "1, 2", requireMention: "true" }),
    ).toBeInstanceOf(TelegramAdapter);
  });

  it.each([
    ["token", { token: 5 }],
    ["allowedUsers", { token: "1:a", allowedUsers: 5 }],
    ["allowedUsers", { token: "1:a", allowedUsers: "," }],
    ["allowedUsers", { token: "1:a", allowedUsers: "1,,2" }],
    ["allowedUsers", { token: "1:a", allowedUsers: "1," }],
    ["allowedUsers", { token: "1:a", allowedUsers: "  " }],
    ["allowedUsers", { token: "1:a", allowedUsers: ["1", ""] }],
    ["requireMention", { token: "1:a", requireMention: "yes" }],
    ["requireMention", { token: "1:a", requireMention: null }],
    ["requireMention", { token: "1:a", requireMention: "" }],
  ])("throws invalid_config naming %s", (key, config) => {
    const err = configurationErrorOf(() => telegramChannel.create(config));
    expect(err.code).toBe("invalid_config");
    expect(err.message).toContain(key);
  });

  it("a comma-separated allowedUsers admits the listed users and drops others", async () => {
    const adapter = telegramChannel.create({ token: "1:a", allowedUsers: "10, 20" });
    adapter.getBot().botInfo = {
      id: 1,
      is_bot: true,
      first_name: "Bot",
      username: "bot",
    } as never;
    const seen: string[] = [];
    adapter.onInbound(async (event) => {
      seen.push(event.text);
    });
    const update = (updateId: number, userId: number) =>
      ({
        update_id: updateId,
        message: {
          message_id: updateId,
          date: 1,
          chat: { id: userId, type: "private", first_name: "U" },
          from: { id: userId, is_bot: false, first_name: "U" },
          text: `from ${userId}`,
        },
      }) as never;
    await adapter.getBot().handleUpdate(update(1, 10));
    await adapter.getBot().handleUpdate(update(2, 20));
    await adapter.getBot().handleUpdate(update(3, 30));
    expect(seen).toEqual(["from 10", "from 20"]);
  });
});

describe("telegramChannel apiBase", () => {
  it("declares an optional apiBase read from TELEGRAM_API_BASE", () => {
    expect(telegramChannel.config).toContainEqual(
      expect.objectContaining({
        key: "apiBase",
        env: "TELEGRAM_API_BASE",
        required: false,
        secret: false,
      }),
    );
  });

  it("builds an adapter with apiBase and refuses a non-string one", () => {
    expect(telegramChannel.create({ token: "123:abc", apiBase: "http://x" })).toBeInstanceOf(
      TelegramAdapter,
    );
    const err = configurationErrorOf(() => telegramChannel.create({ token: "1:a", apiBase: 5 }));
    expect(err.code).toBe("invalid_config");
  });
});
