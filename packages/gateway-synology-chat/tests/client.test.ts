import { describe, expect, it } from "vitest";

import { SynologyChatClient } from "../src/client.js";
import { INCOMING_URL, ScriptedNas } from "./fixtures.js";

describe("SynologyChatClient", () => {
  it("asks user_list on the incoming URL with the method replaced", async () => {
    const nas = new ScriptedNas();
    const client = new SynologyChatClient(INCOMING_URL, nas.fetch);

    await expect(client.userList(new AbortController().signal)).resolves.toEqual({ ok: true });
    expect(nas.calls[0]?.url.searchParams.get("method")).toBe("user_list");
    expect(nas.calls[0]?.url.searchParams.get("token")).toBe('"incoming-secret-xyz"');
  });

  it("reports a user_list that does not answer success true", async () => {
    const nas = new ScriptedNas();
    nas.userList = async () => Response.json({ success: false, error: { code: 105 } });
    const client = new SynologyChatClient(INCOMING_URL, nas.fetch);

    await expect(client.userList(new AbortController().signal)).resolves.toEqual({
      ok: false,
      reason: "user_list answered error code 105",
    });
  });

  it("posts payload with exactly the given user id", async () => {
    const nas = new ScriptedNas();
    const client = new SynologyChatClient(INCOMING_URL, nas.fetch);
    await client.post(42, "hi", new AbortController().signal);

    expect(nas.posts()).toEqual([{ text: "hi", user_ids: [42] }]);
  });

  it("turns a refused post into its error code", async () => {
    const nas = new ScriptedNas();
    nas.chatbot = async () => Response.json({ success: false, error: { code: 120 } });
    const client = new SynologyChatClient(INCOMING_URL, nas.fetch);

    await expect(client.post(42, "hi", new AbortController().signal)).resolves.toEqual({
      ok: false,
      reason: "chatbot answered error code 120",
    });
  });

  it("names no part of the incoming URL's token in an error (EC-12)", async () => {
    const failing = async (): Promise<Response> => {
      throw new TypeError(`fetch failed for ${INCOMING_URL}`);
    };
    const client = new SynologyChatClient(INCOMING_URL, failing);
    const listed = await client.userList(new AbortController().signal);
    const posted = await client.post(42, "hi", new AbortController().signal);

    expect(JSON.stringify([listed, posted])).not.toContain("incoming-secret-xyz");
  });
});
