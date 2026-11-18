import { describe, expect, it } from "vitest";
import { computeZaloSignature, zaloChannel } from "../src/index.js";

const SECRET = "oa";

function signed(raw: string) {
  const ts = String((JSON.parse(raw) as { timestamp: number }).timestamp);
  return { "X-ZEvent-Signature": `mac=${computeZaloSignature("a", raw, ts, SECRET)}` };
}

function build() {
  return zaloChannel.create({ appId: "a", oaSecretKey: SECRET, accessToken: "t" });
}

const body = (id: string) =>
  JSON.stringify({
    event_name: "user_send_text",
    timestamp: "1700000000",
    sender: { id: "u1" },
    message: { msg_id: id, text: "hi" },
  });

describe("zaloChannel", () => {
  it("describes a webhook channel", () => {
    expect(zaloChannel.platform).toBe("zalo");
    expect(zaloChannel.transport).toBe("webhook");
    expect(zaloChannel.config.filter((f) => f.required).map((f) => f.key)).toEqual([
      "appId",
      "oaSecretKey",
      "accessToken",
    ]);
  });

  it("refuses a non-string config value", () => {
    expect(() =>
      zaloChannel.create({ ...{ appId: "a", oaSecretKey: SECRET, accessToken: "t" }, appId: 5 }),
    ).toThrow(/config.appId/);
  });

  it("verifies a signed request and refuses a bad one", () => {
    const adapter = build();
    const raw = body("m1");
    expect(zaloChannel.webhook.verify(adapter, { rawBody: raw, headers: signed(raw) })).toBe(true);
    expect(zaloChannel.webhook.verify(adapter, { rawBody: raw, headers: {} })).toBe(false);
    expect(zaloChannel.webhook.verify(adapter, { rawBody: raw + " ", headers: signed(raw) })).toBe(
      false,
    );
  });

  it("ingests, dedupes and reports malformed and missing handler", async () => {
    const adapter = build();
    expect(await zaloChannel.webhook.ingest(adapter, JSON.parse(body("m1")))).toBe("no_handler");
    const seen: string[] = [];
    adapter.onInbound(async (e) => {
      seen.push(e.text);
    });
    expect(await zaloChannel.webhook.ingest(adapter, "x")).toBe("malformed");
    expect(await zaloChannel.webhook.ingest(adapter, JSON.parse(body("m1")))).toBe("delivered");
    expect(await zaloChannel.webhook.ingest(adapter, JSON.parse(body("m1")))).toBe("delivered");
    expect(await zaloChannel.webhook.ingest(adapter, {})).toBe("delivered");
    expect(seen).toEqual(["hi"]);
  });
});
