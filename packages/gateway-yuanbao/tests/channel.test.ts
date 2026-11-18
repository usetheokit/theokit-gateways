import { describe, expect, it } from "vitest";
import { computeYuanbaoSignature, yuanbaoChannel } from "../src/index.js";

const SECRET = "cb";

const NOW = () => String(Math.floor(Date.now() / 1000));
function signed(raw: string) {
  const ts = NOW();
  return { "X-Signature": computeYuanbaoSignature(SECRET, ts, raw), "x-timestamp": ts };
}

function build() {
  return yuanbaoChannel.create({ appId: "a", appSecret: "s", callbackSecret: SECRET });
}

const body = (id: string) =>
  JSON.stringify({ type: "message", message: { id, text: "hi", from: { id: "u1" } } });

describe("yuanbaoChannel", () => {
  it("describes a webhook channel", () => {
    expect(yuanbaoChannel.platform).toBe("yuanbao");
    expect(yuanbaoChannel.transport).toBe("webhook");
    expect(yuanbaoChannel.config.filter((f) => f.required).map((f) => f.key)).toEqual([
      "appId",
      "appSecret",
      "callbackSecret",
    ]);
  });

  it("refuses a non-string config value", () => {
    expect(() =>
      yuanbaoChannel.create({
        ...{ appId: "a", appSecret: "s", callbackSecret: SECRET },
        appId: 5,
      }),
    ).toThrow(/config.appId/);
  });

  it("verifies a signed request and refuses a bad one", () => {
    const adapter = build();
    const raw = body("m1");
    expect(yuanbaoChannel.webhook.verify(adapter, { rawBody: raw, headers: signed(raw) })).toBe(
      true,
    );
    expect(yuanbaoChannel.webhook.verify(adapter, { rawBody: raw, headers: {} })).toBe(false);
    expect(
      yuanbaoChannel.webhook.verify(adapter, { rawBody: raw + " ", headers: signed(raw) }),
    ).toBe(false);
  });

  it("ingests, dedupes and reports malformed and missing handler", async () => {
    const adapter = build();
    expect(await yuanbaoChannel.webhook.ingest(adapter, JSON.parse(body("m1")))).toBe("no_handler");
    const seen: string[] = [];
    adapter.onInbound(async (e) => {
      seen.push(e.text);
    });
    expect(await yuanbaoChannel.webhook.ingest(adapter, "x")).toBe("malformed");
    expect(await yuanbaoChannel.webhook.ingest(adapter, JSON.parse(body("m1")))).toBe("delivered");
    expect(await yuanbaoChannel.webhook.ingest(adapter, JSON.parse(body("m1")))).toBe("delivered");
    expect(await yuanbaoChannel.webhook.ingest(adapter, {})).toBe("delivered");
    expect(seen).toEqual(["hi"]);
  });
});
