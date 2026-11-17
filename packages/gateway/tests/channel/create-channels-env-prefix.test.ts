import { describe, expect, it } from "vitest";

import type { ChannelDescriptor } from "../../src/channel/channel-descriptor.js";
import { createChannels } from "../../src/channel/create-channels.js";
import { MockAdapter } from "../adapter/mock-adapter.js";

const descriptor: ChannelDescriptor<MockAdapter> = {
  platform: "telegram",
  transport: "socket",
  config: [
    { key: "token", env: "TELEGRAM_TOKEN", required: true, secret: true, description: "token" },
    { key: "other", required: true, description: "no env" },
  ],
  create: () => new MockAdapter("telegram"),
};

describe("createChannels envPrefix", () => {
  it("names prefix + env for a missing required field, and the key when it has no env", () => {
    const { rejected } = createChannels([{ descriptor, config: {}, envPrefix: "APP_" }]);
    expect(rejected[0]?.error.code).toBe("missing_required_config");
    expect(rejected[0]?.error.message).toContain("APP_TELEGRAM_TOKEN");
    expect(rejected[0]?.error.message).toContain("other");
  });

  it("names the bare env when no prefix is given", () => {
    const { rejected } = createChannels([{ descriptor, config: {} }]);
    expect(rejected[0]?.error.message).toContain("TELEGRAM_TOKEN");
  });
});
