import { describe, expect, it } from "vitest";

import { type ChannelDescriptor, isAuthenticatedSender } from "../src/index.js";

const base = { platform: "telegram", transport: "socket", config: [] } as unknown as Omit<
  ChannelDescriptor,
  "senderIdentity"
>;

describe("isAuthenticatedSender", () => {
  it("is true for authenticated", () => {
    expect(
      isAuthenticatedSender({ ...base, senderIdentity: "authenticated" } as ChannelDescriptor),
    ).toBe(true);
  });
  it("is false for unauthenticated", () => {
    expect(
      isAuthenticatedSender({
        ...base,
        senderIdentity: { unauthenticated: "x" },
      } as ChannelDescriptor),
    ).toBe(false);
  });
  it("is false when absent", () => {
    expect(isAuthenticatedSender(base as ChannelDescriptor)).toBe(false);
  });
});
