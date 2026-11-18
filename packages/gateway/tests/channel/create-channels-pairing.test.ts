/** B-049: `createChannels` returned adapters without the descriptor that built each. */

import { describe, expect, it } from "vitest";

import type { ChannelDescriptor } from "../../src/channel/channel-descriptor.js";
import { createChannels } from "../../src/channel/create-channels.js";
import type { PlatformName } from "../../src/types/message-event.js";
import { MockAdapter } from "../adapter/mock-adapter.js";

function descriptorFor(platform: PlatformName): ChannelDescriptor<MockAdapter> {
  return {
    platform,
    transport: "socket",
    config: [{ key: "token", required: true, secret: true, description: "bot token" }],
    create: () => new MockAdapter(platform),
  };
}

describe("createChannels pairing", () => {
  it("pairs_each_adapter_with_its_descriptor_skipping_rejected_entries", () => {
    const tg = descriptorFor("telegram");
    const bad = descriptorFor("discord");
    const sl = descriptorFor("slack");
    const result = createChannels([
      { descriptor: tg, config: { token: "a" } },
      { descriptor: bad },
      { descriptor: sl, config: { token: "b" } },
    ]);
    expect(result.channels).toHaveLength(2);
    expect(result.channels.map((c) => c.descriptor)).toEqual([tg, sl]);
    expect(result.channels.map((c) => c.adapter)).toEqual(result.adapters);
    for (const c of result.channels) expect(c.adapter.platform).toBe(c.descriptor.platform);
  });

  it("names_the_full_prefixed_variable_when_envPrefix_is_given", () => {
    const d: ChannelDescriptor<MockAdapter> = {
      ...descriptorFor("slack"),
      config: [
        { key: "token", env: "SLACK_TOKEN", required: true, secret: true, description: "t" },
      ],
    };
    const [withPrefix] = createChannels([{ descriptor: d, envPrefix: "APP_" }]).rejected;
    expect(withPrefix?.error.message).toBe(
      "channel slack: missing required config APP_SLACK_TOKEN",
    );
    const [without] = createChannels([{ descriptor: d }]).rejected;
    expect(without?.error.message).toBe("channel slack: missing required config token");
  });
});
