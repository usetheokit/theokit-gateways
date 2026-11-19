import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { EmailAdapter } from "../src/adapter.js";
import { emailChannel } from "../src/channel.js";

const ENV: Record<string, string> = {
  APP_EMAIL_ADDRESS: "bot@example.org",
  APP_EMAIL_PASSWORD: "pw_secret",
  APP_EMAIL_IMAP_HOST: "imap.example.org",
  APP_EMAIL_SMTP_HOST: "smtp.example.org",
};

describe("emailChannel", () => {
  it("builds the adapter from configFromEnv with every required variable set", () => {
    const { config, missing } = configFromEnv(emailChannel, ENV, "APP_");
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: emailChannel, config, envPrefix: "APP_" }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(EmailAdapter);
  });

  for (const field of emailChannel.config.filter((f) => f.required && f.env !== undefined)) {
    it(`reports ${field.env} when it is unset`, () => {
      const env = { ...ENV };
      delete env[`APP_${field.env}`];
      const { config, missing } = configFromEnv(emailChannel, env, "APP_");
      expect(missing).toEqual([`APP_${field.env}`]);
      const result = createChannels([{ descriptor: emailChannel, config, envPrefix: "APP_" }]);
      expect(result.adapters).toEqual([]);
      expect(result.rejected[0]?.error).toMatchObject({ code: "missing_required_config" });
      expect(result.rejected[0]?.error.message).toContain(`APP_${field.env}`);
      expect(missing[0]).toBe(`APP_${field.env}`);
    });
  }

  it.each(["address", "password", "imapHost", "smtpHost"])(
    "rejects a number for %s with invalid_config naming the key",
    (key) => {
      const { config } = configFromEnv(emailChannel, ENV, "APP_");
      expect.assertions(3);
      try {
        emailChannel.create({ ...config, [key]: 42 });
      } catch (err) {
        expect(err).toBeInstanceOf(GatewayConfigurationError);
        expect((err as GatewayConfigurationError).code).toBe("invalid_config");
        expect((err as Error).message).toContain(key);
      }
    },
  );

  it("rejects a malformed boolean and number", () => {
    const { config } = configFromEnv(emailChannel, ENV, "APP_");
    expect(() => emailChannel.create({ ...config, allowAutomated: "yes" })).toThrow(
      /allowAutomated/,
    );
    expect(() => emailChannel.create({ ...config, allowAutomated: "true" })).not.toThrow();
  });

  it("lists exactly the secret fields in configFromEnv(...).secrets", () => {
    const all = { ...ENV };
    for (const f of emailChannel.config) {
      if (f.env !== undefined) all[`APP_${f.env}`] ??= `value-of-${f.key}`;
    }
    const { secrets } = configFromEnv(emailChannel, all, "APP_");
    const expected = emailChannel.config
      .filter((f) => f.secret && f.env !== undefined)
      .map((f) => all[`APP_${f.env}`]);
    expect(secrets).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });
});

describe("emailChannel list, number and boolean values", () => {
  it("accepts a comma-separated list, digit strings and boolean strings", () => {
    const { config } = configFromEnv(
      emailChannel,
      {
        ...ENV,
        APP_EMAIL_ALLOWED_SENDERS: "a@x.org, b@x.org",
        APP_EMAIL_IMAP_PORT: "993",
        APP_EMAIL_ALLOW_AUTOMATED: "false",
      },
      "APP_",
    );
    expect(() => emailChannel.create(config)).not.toThrow();
    expect(() => emailChannel.create({ ...config, imapPort: "99x" })).toThrow(/imapPort/);
    expect(() => emailChannel.create({ ...config, allowedSenders: [1] })).toThrow(/allowedSenders/);
  });
});

describe("emailChannel null and overflow", () => {
  it("rejects null and an empty string for a supplied optional value", () => {
    const { config } = configFromEnv(emailChannel, ENV, "APP_");
    for (const key of ["allowedSenders", "imapPort", "fromName", "allowAutomated", "cursorStore"]) {
      expect(() => emailChannel.create({ ...config, [key]: null })).toThrow(new RegExp(key));
      if (key !== "allowedSenders") {
        expect(() => emailChannel.create({ ...config, [key]: "" })).toThrow(new RegExp(key));
      }
    }
  });

  it("rejects a digit string that overflows to Infinity", () => {
    const { config } = configFromEnv(emailChannel, ENV, "APP_");
    expect(() => emailChannel.create({ ...config, imapPort: "9".repeat(400) })).toThrow(/imapPort/);
  });
});
