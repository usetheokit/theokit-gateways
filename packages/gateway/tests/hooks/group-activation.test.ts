import { describe, expect, it } from "vitest";
import { groupActivationHook } from "../../src/hooks/group-activation.js";
import type { MessageEvent } from "../../src/types/message-event.js";

function ev(type: "dm" | "group" | "thread", addressed?: boolean, id = "c1"): MessageEvent {
  return {
    id: "1",
    platform: "mattermost",
    sender: { id: "u" },
    channel: { id, type },
    text: "hi",
    receivedAt: 0,
    addressed,
    mattermost: {},
  } as unknown as MessageEvent;
}

describe("groupActivationHook", () => {
  it("blocks unaddressed group and thread messages in mention mode", async () => {
    const h = groupActivationHook({ mode: "mention" });
    expect(await h.pre_inbound?.({ event: ev("group", false) })).toEqual({ block: true });
    expect(await h.pre_inbound?.({ event: ev("thread", false) })).toEqual({ block: true });
  });
  it("passes addressed, unknown and direct messages", async () => {
    const h = groupActivationHook({ mode: "mention" });
    expect(await h.pre_inbound?.({ event: ev("group", true) })).toBeUndefined();
    expect(await h.pre_inbound?.({ event: ev("group") })).toBeUndefined();
    expect(await h.pre_inbound?.({ event: ev("dm", false) })).toBeUndefined();
  });
  it("passes everything in always mode", async () => {
    const h = groupActivationHook({ mode: "always" });
    expect(await h.pre_inbound?.({ event: ev("group", false) })).toBeUndefined();
  });
  it("reads the per-chat mode on every message", async () => {
    const modes = new Map<string, "mention" | "always">();
    const h = groupActivationHook({ mode: "always", modeFor: (id) => modes.get(id) });
    expect(await h.pre_inbound?.({ event: ev("group", false) })).toBeUndefined();
    modes.set("c1", "mention");
    expect(await h.pre_inbound?.({ event: ev("group", false) })).toEqual({ block: true });
    expect(await h.pre_inbound?.({ event: ev("group", false, "c2") })).toBeUndefined();
  });
});
