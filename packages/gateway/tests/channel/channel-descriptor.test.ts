/**
 * Tests for `createChannels` (FR-001, FR-002, NFR-001; alignment AC-001).
 *
 * The descriptors here are built on `MockAdapter`, so no platform package is involved: the core
 * must build and reject channels without knowing which platforms exist.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChannelDescriptor } from "../../src/channel/channel-descriptor.js";
import { createChannels } from "../../src/channel/create-channels.js";
import { GatewayConfigurationError } from "../../src/errors/config-error.js";
import type { PlatformName } from "../../src/types/message-event.js";
import { MockAdapter } from "../adapter/mock-adapter.js";

class ConnectForbiddenAdapter extends MockAdapter {
  override async connect(): Promise<boolean> {
    this.connectCount += 1;
    throw new Error("connect() must not be called by createChannels");
  }
}

function socketDescriptor(
  platform: PlatformName,
  build: (config: Readonly<Record<string, unknown>>) => MockAdapter = () =>
    new MockAdapter(platform),
): ChannelDescriptor<MockAdapter> {
  return {
    platform,
    transport: "socket",
    config: [
      { key: "token", required: true, secret: true, description: "bot token" },
      { key: "allowedUsers", required: false, secret: false, description: "allow-list" },
    ],
    create: build,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createChannels", () => {
  it("builds every entry whose required fields are present", () => {
    const result = createChannels([
      { descriptor: socketDescriptor("telegram"), config: { token: "t" } },
      { descriptor: socketDescriptor("discord"), config: { token: "d" } },
    ]);

    expect(result.adapters.map((a) => a.platform)).toEqual(["telegram", "discord"]);
    expect(result.rejected).toEqual([]);
  });

  it("rejects an entry missing a required field and still builds the others", () => {
    const result = createChannels([
      { descriptor: socketDescriptor("telegram"), config: { token: "t" } },
      { descriptor: socketDescriptor("discord"), config: { token: "" } },
    ]);

    expect(result.adapters.map((a) => a.platform)).toEqual(["telegram"]);
    expect(result.rejected).toHaveLength(1);
    const [rejection] = result.rejected;
    expect(rejection?.platform).toBe("discord");
    expect(rejection?.error).toBeInstanceOf(GatewayConfigurationError);
    expect(rejection?.error.code).toBe("missing_required_config");
    expect(rejection?.error.message).toContain("token");
  });

  it("treats a required field holding 0 or false as present", () => {
    const result = createChannels([
      {
        descriptor: {
          ...socketDescriptor("telegram"),
          config: [
            { key: "port", required: true, secret: false, description: "port" },
            { key: "strict", required: true, secret: false, description: "strict mode" },
          ],
        },
        config: { port: 0, strict: false },
      },
    ]);

    expect(result.adapters).toHaveLength(1);
    expect(result.rejected).toEqual([]);
  });

  it("builds an entry whose optional field is absent", () => {
    const result = createChannels([
      { descriptor: socketDescriptor("discord"), config: { token: "d", allowedUsers: undefined } },
    ]);

    expect(result.adapters).toHaveLength(1);
    expect(result.rejected).toEqual([]);
  });

  it("rejects an entry whose create throws a configuration error", () => {
    const thrown = new GatewayConfigurationError("gateway-mock", { code: "invalid_config" });
    const result = createChannels([
      {
        descriptor: socketDescriptor("telegram", () => {
          throw thrown;
        }),
        config: { token: "t" },
      },
      { descriptor: socketDescriptor("discord"), config: { token: "d" } },
    ]);

    expect(result.rejected).toEqual([{ platform: "telegram", error: thrown }]);
    expect(result.adapters.map((a) => a.platform)).toEqual(["discord"]);
  });

  it("creates channels without connecting or fetching", () => {
    const fetchStub = vi.fn(() => {
      throw new Error("createChannels must not fetch");
    });
    vi.stubGlobal("fetch", fetchStub);
    const result = createChannels([
      {
        descriptor: socketDescriptor("telegram", () => new ConnectForbiddenAdapter("telegram")),
        config: { token: "t" },
      },
      {
        descriptor: socketDescriptor("discord", () => new ConnectForbiddenAdapter("discord")),
        config: { token: "d" },
      },
    ]);

    expect(result.adapters).toHaveLength(2);
    expect(fetchStub).not.toHaveBeenCalled();
    for (const adapter of result.adapters) {
      expect((adapter as MockAdapter).connectCount).toBe(0);
    }
  });

  it("rethrows an error from create that is not a configuration error", () => {
    expect(() =>
      createChannels([
        {
          descriptor: socketDescriptor("telegram", () => {
            throw new TypeError("bug in create");
          }),
          config: { token: "t" },
        },
      ]),
    ).toThrow(TypeError);
  });

  it("rejects an entry with no config as missing every required field", () => {
    const descriptor: ChannelDescriptor<MockAdapter> = {
      ...socketDescriptor("telegram"),
      config: [
        { key: "token", required: true, secret: true, description: "bot token" },
        { key: "chatId", required: true, secret: false, description: "chat id" },
      ],
    };
    const result = createChannels([{ descriptor }]);

    expect(result.adapters).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.error.message).toContain("token");
    expect(result.rejected[0]?.error.message).toContain("chatId");
  });

  it("returns empty lists for an empty entry list", () => {
    expect(createChannels([])).toEqual({ adapters: [], rejected: [] });
  });
});
