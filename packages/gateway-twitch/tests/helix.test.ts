import { describe, expect, it } from "vitest";

import { HelixClient } from "../src/helix.js";
import { BOT, BROADCASTER, FakeHelix, TOKEN } from "./fakes.js";

const signal = (): AbortSignal => new AbortController().signal;

describe("HelixClient", () => {
  it("validates the token with the OAuth scheme and reads its user, client and scopes", async () => {
    const helix = new FakeHelix();
    const client = new HelixClient(TOKEN, helix.fetch);

    await expect(client.validate(signal())).resolves.toEqual({
      ok: true,
      userId: BOT,
      clientId: "client-x",
      scopes: ["user:read:chat", "user:write:chat"],
    });
    expect(helix.headers[0]?.get("authorization")).toBe(`OAuth ${TOKEN}`);
  });

  it("reports a token the validator refuses", async () => {
    const helix = new FakeHelix();
    helix.validateStatus = 401;

    await expect(new HelixClient(TOKEN, helix.fetch).validate(signal())).resolves.toMatchObject({
      ok: false,
    });
  });

  it("sends chat with the Bearer token and the token's Client-Id", async () => {
    const helix = new FakeHelix();
    const client = new HelixClient(TOKEN, helix.fetch);
    await client.validate(signal());
    const result = await client.sendChat(
      { broadcasterId: BROADCASTER, senderId: BOT, text: "hi" },
      signal(),
    );

    expect(result).toEqual({ ok: true, messageId: "sent-1" });
    expect(helix.sent[0]).toEqual({ broadcaster_id: BROADCASTER, sender_id: BOT, message: "hi" });
    expect(helix.headers[1]?.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(helix.headers[1]?.get("client-id")).toBe("client-x");
  });

  it("turns is_sent false into twitch_message_dropped with the drop reason", async () => {
    const helix = new FakeHelix();
    helix.send = async () =>
      Response.json({
        data: [
          {
            message_id: "",
            is_sent: false,
            drop_reason: { code: "msg_duplicate", message: "duplicate message" },
          },
        ],
      });
    const client = new HelixClient(TOKEN, helix.fetch);

    await expect(
      client.sendChat({ broadcasterId: BROADCASTER, senderId: BOT, text: "hi" }, signal()),
    ).resolves.toEqual({
      ok: false,
      code: "twitch_message_dropped",
      message: "duplicate message",
    });
  });

  it("turns a non-2xx answer into twitch_api_error with the status", async () => {
    const helix = new FakeHelix();
    helix.send = async () => new Response(null, { status: 429 });
    const client = new HelixClient(TOKEN, helix.fetch);

    await expect(
      client.sendChat({ broadcasterId: BROADCASTER, senderId: BOT, text: "hi" }, signal()),
    ).resolves.toEqual({
      ok: false,
      code: "twitch_api_error",
      message: "429",
    });
  });
});
