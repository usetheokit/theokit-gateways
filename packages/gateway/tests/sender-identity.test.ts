import { describe, expect, it } from "vitest";

import { type ChannelDescriptor, isAuthenticatedSender } from "../src/index.js";

const base = {
  platform: "telegram",
  transport: "socket",
  config: [],
  create: () => {
    throw new Error("unused");
  },
} as unknown as ChannelDescriptor;

describe("isAuthenticatedSender", () => {
  it("is true for authenticated", () => {
    expect(isAuthenticatedSender({ ...base, senderIdentity: "authenticated" })).toBe(true);
  });
  it("is false for unauthenticated", () => {
    expect(isAuthenticatedSender({ ...base, senderIdentity: { unauthenticated: "x" } })).toBe(
      false,
    );
  });
  it("is false when absent", () => {
    expect(isAuthenticatedSender(base)).toBe(false);
  });
});
