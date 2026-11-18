import { describe, expect, it, vi } from "vitest";

import type { ChannelDescriptor } from "../../src/channel/channel-descriptor.js";
import { createChannels } from "../../src/channel/create-channels.js";
import { MockAdapter } from "../adapter/mock-adapter.js";

const create = vi.fn(() => new MockAdapter("telegram"));
const descriptor: ChannelDescriptor<MockAdapter> = {
  platform: "telegram",
  transport: "socket",
  config: [
    { key: "token", env: "TELEGRAM_TOKEN", required: true, secret: true, description: "token" },
    { key: "nick", required: true, secret: false, description: "no env binding" },
  ],
  create,
};

describe("createChannels envPrefix", () => {
  it("names the full variable for a missing field with an env binding", () => {
    const result = createChannels([{ descriptor, config: { nick: "n" }, envPrefix: "APP_" }]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain("APP_TELEGRAM_TOKEN");
  });

  it("names the unprefixed variable without envPrefix, and only the key without an env binding", () => {
    const plain = createChannels([{ descriptor, config: { nick: "n" } }]);
    expect(plain.rejected[0]?.error.message).toBe(
      "channel telegram: missing required config token (env TELEGRAM_TOKEN)",
    );
    const unbound = createChannels([{ descriptor, config: { token: "t" }, envPrefix: "APP_" }]);
    expect(unbound.rejected[0]?.error.message).toBe(
      "channel telegram: missing required config nick",
    );
  });
});
