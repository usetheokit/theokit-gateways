/**
 * TeamsAdapter.editMessage — replaces a sent activity's text through `app.api.conversations`.
 *
 * Two SDK shapes are in the `^2.0.0` peer range: from `@microsoft/teams.api` 2.0.14 the
 * conversation client has `updateActivity(conversationId, activityId, params)`, and below it only
 * the grouped `activities(conversationId).update(activityId, params)`. The adapter uses the first
 * when the installed SDK has it and the second otherwise (plan D5); both are faked here through
 * `__appFactory`, as `adapter.test.ts` does. The E1 to E7 labels are the plan's shared edit
 * behaviours (gateway-preview-streaming, Phase 2).
 */

import type { OutboundMessage } from "@theokit/gateway";
import { describe, expect, it, vi } from "vitest";

import { TeamsAdapter } from "../src/adapter.js";
import { splitForTeams } from "../src/split.js";

type ApiShape = "updateActivity" | "activities" | "none";

function makeFakeApp(shape: ApiShape) {
  const update = vi.fn(async (_activityId: string, _params: unknown) => ({ id: "a1" }));
  const activities = vi.fn((_conversationId: string) => ({ update }));
  const updateActivity = vi.fn(
    async (_conversationId: string, _activityId: string, _params: unknown) => ({ id: "a1" }),
  );
  const conversations =
    shape === "updateActivity" ? { activities, updateActivity } : { activities };
  const app = {
    initialize: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    send: vi.fn(async () => ({ id: "sent-1" })),
    on: vi.fn(),
    ...(shape === "none" ? {} : { api: { conversations } }),
  };
  return { app, update, activities, updateActivity };
}

function makeAdapter(shape: ApiShape = "updateActivity") {
  const fake = makeFakeApp(shape);
  const adapter = new TeamsAdapter({
    clientId: "client-1",
    clientSecret: "secret-1",
    tenantId: "tenant-1",
    __appFactory: () => fake.app as never,
    __tokenFetcher: async () => ({ ok: true, status: 200 }),
  });
  return { adapter, ...fake };
}

async function connected(shape: ApiShape = "updateActivity") {
  const made = makeAdapter(shape);
  expect(await made.adapter.connect()).toBe(true);
  return made;
}

const CONVERSATION = "19:conv@thread.v2";

const out = (text: string, format?: OutboundMessage["format"]): OutboundMessage => ({
  channel: { id: CONVERSATION, type: "group" },
  text,
  ...(format !== undefined ? { format } : {}),
});

/** The largest text length `splitForTeams` still returns as one part, read from the splitter. */
function singlePartLimit(): number {
  let fits = 1;
  let splits = 1_000_000;
  while (splits - fits > 1) {
    const mid = Math.floor((fits + splits) / 2);
    if (splitForTeams("a".repeat(mid)).length === 1) fits = mid;
    else splits = mid;
  }
  return fits;
}

describe("TeamsAdapter.editMessage", () => {
  it("reports supportsEdit as true before and after connect (E1)", async () => {
    const { adapter } = makeAdapter();
    expect(adapter.supportsEdit).toBe(true);
    await adapter.connect();
    expect(adapter.supportsEdit).toBe(true);
  });

  it("edits through updateActivity(conversationId, activityId, params) once (E2, D5)", async () => {
    const { adapter, updateActivity, activities } = await connected("updateActivity");

    const result = await adapter.editMessage("a1", out("hello"));

    expect(result).toEqual({ ok: true, messageId: "a1" });
    expect(updateActivity).toHaveBeenCalledTimes(1);
    expect(updateActivity).toHaveBeenCalledWith(CONVERSATION, "a1", {
      type: "message",
      text: "hello",
    });
    expect(activities).toHaveBeenCalledTimes(0);
  });

  it("edits through activities(conversationId).update(activityId, params) once without updateActivity (E2, D5)", async () => {
    const { adapter, activities, update } = await connected("activities");

    const result = await adapter.editMessage("a1", out("hello"));

    expect(result).toEqual({ ok: true, messageId: "a1" });
    expect(activities).toHaveBeenCalledTimes(1);
    expect(activities).toHaveBeenCalledWith(CONVERSATION);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("a1", { type: "message", text: "hello" });
  });

  it("refuses a text the splitter would cut in two as edit_too_long with no request (E3)", async () => {
    const { adapter, updateActivity } = await connected();
    const limit = singlePartLimit();

    const tooLong = await adapter.editMessage("a1", out("a".repeat(limit + 1)));
    expect(tooLong.ok).toBe(false);
    expect(tooLong.error?.code).toBe("edit_too_long");
    expect(updateActivity).toHaveBeenCalledTimes(0);

    const atLimit = await adapter.editMessage("a1", out("a".repeat(limit)));
    expect(atLimit).toEqual({ ok: true, messageId: "a1" });
    expect(updateActivity).toHaveBeenCalledTimes(1);
  });

  it.each([
    [404, "invalid_request"],
    [429, "rate_limit"],
    [403, "auth_failed"],
  ])("maps a %i refusal through mapTeamsError without throwing (E4)", async (status, code) => {
    const { adapter, updateActivity } = await connected();
    updateActivity.mockRejectedValueOnce(Object.assign(new Error(`refused ${status}`), { status }));

    const result = await adapter.editMessage("a1", out("hello"));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(code);
    expect(updateActivity).toHaveBeenCalledTimes(1);
  });

  it("maps a refusal on the activities fallback without throwing (E4)", async () => {
    const { adapter, update } = await connected("activities");
    update.mockRejectedValueOnce(Object.assign(new Error("refused"), { status: 429 }));

    const result = await adapter.editMessage("a1", out("hello"));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("rate_limit");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("returns the mapped error for malformed markup after exactly 1 request (D1)", async () => {
    const { adapter, updateActivity, app } = await connected();
    updateActivity.mockRejectedValueOnce(
      Object.assign(new Error("malformed"), { statusCode: 400 }),
    );

    const result = await adapter.editMessage("a1", out("**hi**", "markdown"));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_request");
    expect(updateActivity).toHaveBeenCalledTimes(1);
    expect(app.send).toHaveBeenCalledTimes(0);
  });

  it("refuses empty text as empty_text with no request (E5)", async () => {
    const { adapter, updateActivity } = await connected();
    const result = await adapter.editMessage("a1", out(""));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("empty_text");
    expect(updateActivity).toHaveBeenCalledTimes(0);
  });

  it("refuses an edit before connect as not_connected with no request (E5)", async () => {
    const { adapter, updateActivity } = makeAdapter();
    const result = await adapter.editMessage("a1", out("hello"));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("not_connected");
    expect(updateActivity).toHaveBeenCalledTimes(0);
  });

  it("refuses whitespace-only text, which splitForTeams reduces to zero parts, as empty_text (E5)", async () => {
    const { adapter, updateActivity } = await connected();
    const result = await adapter.editMessage("a1", out("   \n\n  "));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("empty_text");
    expect(updateActivity).toHaveBeenCalledTimes(0);
  });

  it("edits text with surrounding whitespace as the trimmed part sendMessage would send", async () => {
    const { adapter, updateActivity } = await connected();
    const [part] = splitForTeams("  hello  ");

    await adapter.editMessage("a1", out("  hello  "));

    expect(updateActivity).toHaveBeenCalledWith(CONVERSATION, "a1", {
      type: "message",
      text: part,
    });
    expect(part).toBe("hello");
  });

  it("refuses an empty message id as invalid_message_id with no request (E6)", async () => {
    const { adapter, updateActivity } = await connected();
    const result = await adapter.editMessage("", out("hello"));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_message_id");
    expect(updateActivity).toHaveBeenCalledTimes(0);
  });

  it.each([
    ["markdown", { textFormat: "markdown" }],
    ["html", { textFormat: "xml" }],
    ["plain", {}],
  ] as const)(
    "sets textFormat for format %s as the send path does (E7)",
    async (format, fragment) => {
      const { adapter, updateActivity } = await connected();
      await adapter.editMessage("a1", out("hi", format));
      expect(updateActivity).toHaveBeenCalledWith(CONVERSATION, "a1", {
        type: "message",
        text: "hi",
        ...fragment,
      });
    },
  );

  it("answers an edit with { ok: false } and does not throw when the app has no api", async () => {
    const { adapter } = await connected("none");
    const result = await adapter.editMessage("a1", out("hello"));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("unknown");
  });
});
