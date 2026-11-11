/** MatrixAdapter.react — an `m.reaction` event with an `m.annotation` relation, on a fake client. */

import { describe, expect, it, vi } from "vitest";

import { MatrixAdapter } from "../src/adapter.js";

function build(withSendEvent = true) {
  const sendEvent = vi.fn(async (..._a: unknown[]) => ({ event_id: "$r:server" }));
  const getRoomIdForAlias = vi.fn(async (alias: string) => ({ room_id: `!r-${alias}:server` }));
  const client = {
    ...(withSendEvent ? { sendEvent } : {}),
    sendTextMessage: async () => ({ event_id: "$t" }),
    getRoomIdForAlias,
    on: () => undefined,
    off: () => undefined,
    whoami: async () => ({ user_id: "@bot:example.org" }),
    startClient: async () => undefined,
    stopClient: () => undefined,
    getRoom: () => null,
    getUserId: () => "@bot:example.org",
  };
  const adapter = new MatrixAdapter({
    homeserverUrl: "https://matrix.example.org",
    accessToken: "t",
    userId: "@bot:example.org",
    __clientFactory: () => client as never,
  });
  return { adapter, sendEvent, getRoomIdForAlias };
}

describe("MatrixAdapter.react", () => {
  it("sends an m.annotation reaction on the event", async () => {
    const { adapter, sendEvent } = build();
    await adapter.connect();
    expect(await adapter.react("!room:server", "$ev:server", "👀")).toEqual({
      ok: true,
      messageId: "$ev:server",
    });
    expect(sendEvent).toHaveBeenCalledWith("!room:server", "m.reaction", {
      "m.relates_to": { rel_type: "m.annotation", event_id: "$ev:server", key: "👀" },
    });
  });

  it("resolves a #alias to its room first", async () => {
    const { adapter, sendEvent, getRoomIdForAlias } = build();
    await adapter.connect();
    await adapter.react("#general:server", "$ev", "👀");
    expect(getRoomIdForAlias).toHaveBeenCalledWith("#general:server");
    expect(sendEvent.mock.calls[0]?.[0]).toBe("!r-#general:server:server");
  });

  it("answers react_unsupported when the client has no sendEvent", async () => {
    const { adapter } = build(false);
    await adapter.connect();
    expect((await adapter.react("!room:server", "$ev", "👀")).error?.code).toBe(
      "react_unsupported",
    );
  });

  it("answers not_connected before connect", async () => {
    const { adapter } = build();
    expect((await adapter.react("!room:server", "$ev", "👀")).error?.code).toBe("not_connected");
  });
});
