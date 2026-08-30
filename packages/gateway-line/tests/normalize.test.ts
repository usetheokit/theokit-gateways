import { describe, expect, it } from "vitest";

import { lineEventToMessageEvent, mapSourceType } from "../src/normalize.js";
import type { LineWebhookEvent } from "../src/types.js";

function textEvent(overrides: Partial<LineWebhookEvent> = {}): LineWebhookEvent {
  return {
    type: "message",
    timestamp: 1700000000000,
    source: { type: "user", userId: "U-alice" },
    replyToken: "rtok",
    message: { type: "text", id: "m-1", text: "hi", mentionees: [] },
    ...overrides,
  };
}

describe("mapSourceType (D410)", () => {
  it("user → dm", () => {
    expect(mapSourceType("user")).toBe("dm");
  });

  it("group → group", () => {
    expect(mapSourceType("group")).toBe("group");
  });

  it("room → group", () => {
    expect(mapSourceType("room")).toBe("group");
  });
});

describe("lineEventToMessageEvent — EC-4 type filter", () => {
  it("filters non-message event (follow)", () => {
    expect(
      lineEventToMessageEvent({ type: "follow", source: { type: "user", userId: "U-a" } }),
    ).toBeUndefined();
  });

  it("filters unfollow event", () => {
    expect(
      lineEventToMessageEvent({ type: "unfollow", source: { type: "user", userId: "U-a" } }),
    ).toBeUndefined();
  });

  it("filters postback event", () => {
    expect(
      lineEventToMessageEvent({ type: "postback", source: { type: "user", userId: "U-a" } }),
    ).toBeUndefined();
  });

  it("filters non-text message (image)", () => {
    const e = textEvent({ message: { type: "image", id: "im-1" } });
    expect(lineEventToMessageEvent(e)).toBeUndefined();
  });

  it("filters when message field is missing", () => {
    const e = textEvent();
    const stripped: LineWebhookEvent = {
      type: e.type,
      ...(e.source !== undefined ? { source: e.source } : {}),
      ...(e.replyToken !== undefined ? { replyToken: e.replyToken } : {}),
      ...(e.timestamp !== undefined ? { timestamp: e.timestamp } : {}),
    };
    expect(lineEventToMessageEvent(stripped)).toBeUndefined();
  });

  it("returns undefined when source.userId/groupId/roomId all missing", () => {
    expect(lineEventToMessageEvent(textEvent({ source: { type: "user" } }))).toBeUndefined();
  });
});

describe("lineEventToMessageEvent — happy paths", () => {
  it("user source → channel.type=dm + sender.id=userId", () => {
    const event = lineEventToMessageEvent(textEvent());
    expect(event?.platform).toBe("line");
    expect(event?.channel.type).toBe("dm");
    expect(event?.sender.id).toBe("U-alice");
    expect(event?.text).toBe("hi");
    if (event?.platform === "line") {
      expect(event.line.sourceType).toBe("user");
      expect(event.line.replyToken).toBe("rtok");
    }
  });

  it("group source → channel.type=group + channel.id=groupId", () => {
    const event = lineEventToMessageEvent(
      textEvent({
        source: { type: "group", groupId: "G-1", userId: "U-alice" },
      }),
    );
    expect(event?.channel.type).toBe("group");
    expect(event?.channel.id).toBe("G-1");
    expect(event?.sender.id).toBe("U-alice");
  });

  it("room source → channel.type=group", () => {
    const event = lineEventToMessageEvent(
      textEvent({
        source: { type: "room", roomId: "R-1", userId: "U-alice" },
      }),
    );
    expect(event?.channel.type).toBe("group");
    expect(event?.channel.id).toBe("R-1");
  });

  it("extracts mentionees array (D409)", () => {
    const event = lineEventToMessageEvent(
      textEvent({
        message: {
          type: "text",
          id: "m-1",
          text: "@bot hi",
          mentionees: [{ index: 0, length: 4, userId: "U-bot" }],
        },
      }),
    );
    if (event?.platform === "line") {
      expect(event.line.mentionees).toEqual(["U-bot"]);
    } else {
      throw new Error("expected line event");
    }
  });

  it("ignores mentionee entries without userId", () => {
    const event = lineEventToMessageEvent(
      textEvent({
        message: {
          type: "text",
          id: "m-1",
          text: "@all hi",
          mentionees: [{ index: 0, length: 4 }], // no userId
        },
      }),
    );
    if (event?.platform === "line") {
      expect(event.line.mentionees).toEqual([]);
    }
  });

  it("falls back to the group id as the sender when there is no user id", () => {
    // `source.userId !== undefined ? { id: source.userId } : { id: sourceId }`. Every case had a
    // userId, so the fallback arm was unreachable — and it is the arm LINE takes for a message
    // posted into a group by something with no user identity. Without it the sender would be
    // `undefined` and every downstream consumer keyed on sender.id breaks, far from here.
    const e = lineEventToMessageEvent(textEvent({ source: { type: "group", groupId: "G-team" } }));

    expect(e?.sender.id).toBe("G-team");
    expect(e?.channel.id).toBe("G-team");
  });

  it("synthesises an id and a timestamp when LINE sends neither", () => {
    // `event.message.id ?? \`line-${event.timestamp ?? Date.now()}\`` and
    // `event.timestamp ?? Date.now()`. Both fallbacks were unreached: the fixture always supplies
    // both. An event with no id collides with every other id-less event in any consumer that
    // dedups, which is the reason the synthesised one carries the timestamp.
    const before = Date.now();
    const e = lineEventToMessageEvent({
      type: "message",
      source: { type: "user", userId: "U-alice" },
      message: { type: "text", text: "hi" },
    } as LineWebhookEvent);

    expect(e?.id).toMatch(/^line-\d+$/);
    expect(e?.receivedAt).toBeGreaterThanOrEqual(before);
    // The nested copy takes the empty string rather than the synthesised id, because it reports
    // what LINE sent — and what LINE sent was nothing.
    expect(e?.line.messageId).toBe("");
  });

  it("uses the timestamp LINE sent rather than the moment it was read", () => {
    // `event.timestamp ?? Date.now()`. Only the fixture's timestamp was ever present and no test
    // asserted `receivedAt`, so the whole expression could have been `Date.now()` — every event
    // stamped with processing time instead of send time, which on a backed-up webhook queue are
    // far apart.
    const e = lineEventToMessageEvent(textEvent({ timestamp: 1_700_000_000_123 }));

    expect(e?.receivedAt).toBe(1_700_000_000_123);
  });

  it("preserves raw event in event.line.raw", () => {
    const raw = textEvent();
    const event = lineEventToMessageEvent(raw);
    if (event?.platform === "line") {
      expect(event.line.raw).toBe(raw);
    }
  });
});
