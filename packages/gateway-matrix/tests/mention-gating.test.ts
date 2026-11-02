import type { MessageEvent } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { MatrixAdapter } from "../src/adapter.js";
import { matrixEventToMessageEvent } from "../src/normalize.js";
import type { MatrixEventLike, MatrixRoomLike } from "../src/types.js";

const BOT = "@bot:matrix.org";

type Content = {
  body?: string;
  msgtype?: string;
  formatted_body?: string;
  "m.mentions"?: { user_ids?: string[]; room?: boolean };
};

function matrixEvent(content: Content, members: number): MessageEvent {
  const raw: MatrixEventLike = {
    getId: () => "$evt:server",
    getSender: () => "@alice:matrix.org",
    getRoomId: () => "!r:server",
    getType: () => "m.room.message",
    getContent: () => ({ msgtype: "m.text", ...content }),
    getTs: () => Date.now(),
  };
  const room: MatrixRoomLike = { roomId: "!r:server", getJoinedMemberCount: () => members };
  const event = matrixEventToMessageEvent(raw, room);
  if (event === undefined) throw new Error("fixture did not normalize");
  return event;
}

function build(requireMention?: boolean) {
  const adapter = new MatrixAdapter({
    homeserverUrl: "https://matrix.org",
    accessToken: "t",
    userId: BOT,
    ...(requireMention === undefined ? {} : { requireMention }),
  });
  const received: MessageEvent[] = [];
  adapter.onInbound(async (event) => {
    received.push(event);
  });
  return { adapter, received };
}

describe("MatrixAdapter.deliver mention gating (FR-001 to FR-003, FR-005)", () => {
  it("does not deliver an unmentioned group event and answers ok", async () => {
    const { adapter, received } = build(true);
    expect(await adapter.deliver(matrixEvent({ body: "hello" }, 5))).toBe("ok");
    expect(received).toHaveLength(0);
  });

  it("gates by default, because requireMention defaults to true", async () => {
    const { adapter, received } = build();
    await adapter.deliver(matrixEvent({ body: "hello" }, 5));
    expect(received).toHaveLength(0);
  });

  it("delivers the same event once when requireMention is false", async () => {
    const { adapter, received } = build(false);
    await adapter.deliver(matrixEvent({ body: "hello" }, 5));
    expect(received).toHaveLength(1);
  });

  it("delivers an event whose m.mentions.user_ids holds the bot once in both modes", async () => {
    for (const mode of [true, false]) {
      const { adapter, received } = build(mode);
      await adapter.deliver(matrixEvent({ body: "hi", "m.mentions": { user_ids: [BOT] } }, 5));
      expect(received).toHaveLength(1);
    }
  });

  it("does not deliver when m.mentions is present without the bot, even if the body names it", async () => {
    const { adapter, received } = build(true);
    await adapter.deliver(
      matrixEvent({ body: `${BOT} hi`, "m.mentions": { user_ids: ["@carol:matrix.org"] } }, 5),
    );
    expect(received).toHaveLength(0);
  });

  it("does not treat m.mentions.room alone as a mention", async () => {
    const { adapter, received } = build(true);
    await adapter.deliver(matrixEvent({ body: "all", "m.mentions": { room: true } }, 5));
    expect(received).toHaveLength(0);
  });

  it("delivers when there is no m.mentions and the body contains the bot id", async () => {
    const { adapter, received } = build(true);
    await adapter.deliver(matrixEvent({ body: `${BOT}: hi` }, 5));
    expect(received).toHaveLength(1);
  });

  it("delivers when there is no m.mentions and only formatted_body holds the id (mention pill)", async () => {
    const { adapter, received } = build(true);
    await adapter.deliver(
      matrixEvent(
        { body: "bot: hi", formatted_body: `<a href="https://matrix.to/#/${BOT}">bot</a>: hi` },
        5,
      ),
    );
    expect(received).toHaveLength(1);
  });

  it("answers ok for a dropped event with no handler subscribed", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: BOT,
    });
    expect(await adapter.deliver(matrixEvent({ body: "hello" }, 5))).toBe("ok");
  });

  it("delivers a DM (2-member room) once in both modes", async () => {
    for (const mode of [true, false]) {
      const { adapter, received } = build(mode);
      await adapter.deliver(matrixEvent({ body: "hello" }, 2));
      expect(received).toHaveLength(1);
    }
  });

  it("reads the text for the bot id when the raw event is not a MatrixEventLike", async () => {
    const { adapter, received } = build(true);
    const event = matrixEvent({ body: "hello" }, 5);
    if (event.platform !== "matrix") throw new Error("fixture is not a matrix event");
    const hand = { ...event, text: `${BOT} hi`, matrix: { ...event.matrix, raw: {} } };
    await adapter.deliver(hand as unknown as MessageEvent);
    expect(received).toHaveLength(1);
  });
});
