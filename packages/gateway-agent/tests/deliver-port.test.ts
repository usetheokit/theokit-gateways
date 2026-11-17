import type { DeliverPort } from "@theokit/agents/tools";
import {
  type BasePlatformAdapter,
  channelRendering,
  maskSecrets,
  type OutboundMessage,
} from "@theokit/gateway";
import { ChatPresenter } from "@theokit/presenter";
import { describe, expect, expectTypeOf, it } from "vitest";

import { gatewayDeliverPort, parseChannelTarget } from "../src/index.js";

function fake(
  send: (m: OutboundMessage) => Promise<unknown>,
  platform = "slack",
): BasePlatformAdapter {
  return { platform, sendMessage: send } as unknown as BasePlatformAdapter;
}

const ok = async () => ({ ok: true, messageId: "m1" });

describe("gatewayDeliverPort", () => {
  it("reads adapters on every send", async () => {
    const list: BasePlatformAdapter[] = [];
    const port = gatewayDeliverPort(() => list);
    const target = { platform: "slack", channelId: "C1" };
    expect(await port(target, "hi")).toEqual({ ok: false, error: { code: "not_started" } });
    list.push(fake(ok));
    expect(await port(target, "hi")).toEqual({ ok: true });
  });

  it("maps a throw to adapter_threw and a refusal to its code", async () => {
    const target = { platform: "slack", channelId: "C1" };
    const thrower = fake(async () => {
      throw new Error("boom");
    });
    expect(await gatewayDeliverPort(() => [thrower])(target, "x")).toEqual({
      ok: false,
      error: { code: "adapter_threw" },
    });
    const refuser = fake(async () => ({ ok: false, error: { code: "rate_limited" } }));
    expect(await gatewayDeliverPort(() => [refuser])(target, "x")).toEqual({
      ok: false,
      error: { code: "rate_limited" },
    });
  });

  it("masks secrets then renders for the platform", async () => {
    const sent: OutboundMessage[] = [];
    const adapter = fake(async (m) => {
      sent.push(m);
      return { ok: true, messageId: "m1" };
    });
    const port = gatewayDeliverPort(() => [adapter], { secrets: ["s3cr3t"] });
    await port({ platform: "slack", channelId: "C1" }, "**key** s3cr3t");
    expect(JSON.stringify(sent)).not.toContain("s3cr3t");

    const masked = maskSecrets("**key** s3cr3t", ["s3cr3t"]);
    const presenter = new ChatPresenter({
      channel: { id: "C1", type: "dm" },
      ...channelRendering("slack"),
    });
    presenter.present({ type: "text", text: masked });
    expect(sent).toEqual(presenter.present({ type: "finish" }));
  });

  it("is assignable to the agents DeliverPort", () => {
    const port = gatewayDeliverPort(() => []);
    expectTypeOf(port).toMatchTypeOf<DeliverPort>();
    const assigned: DeliverPort = port;
    expect(assigned).toBe(port);
  });
});

describe("parseChannelTarget", () => {
  it("keeps further colons", () => {
    expect(parseChannelTarget("matrix:!room:example.org")).toEqual({
      platform: "matrix",
      channelId: "!room:example.org",
    });
  });

  it.each(["slack", ":C1", "slack:"])("rejects %s", (spec) => {
    try {
      parseChannelTarget(spec);
      expect.unreachable();
    } catch (error) {
      expect((error as { code: string }).code).toBe("invalid_channel_target");
      expect((error as Error).message).not.toContain("C1");
    }
  });
});
