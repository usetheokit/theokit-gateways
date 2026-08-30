/**
 * The reconnect path — the one thing `adapter.test.ts` structurally cannot see.
 *
 * Every test there installs its handle through `installMockHandle`, which writes `handle` and
 * `connected` straight onto the adapter and never calls `connect()`. That is the right trade for
 * testing message flow, and it means the real `connect()` — and the `connected` guard on it — is
 * exercised by nothing.
 *
 * The gap is not theoretical. `connect()` opens with `if (this.connected) return true;` and
 * `disconnect()` clears the flag. Delete that one line and the guard becomes a latch: `connect()`
 * answers `true`, opens no socket, and the bot is deaf while every health check reads green. It is
 * the same shape as the write-once latches fixed in the LINE and SMS webhook servers. Mutating it
 * left all of this package's tests passing.
 *
 * Mocking the client module is why this lives in its own file: Vitest isolates module registries
 * per file, so `adapter.test.ts` keeps the real one.
 */

import { describe, expect, it, vi } from "vitest";

const connectMattermost = vi.fn(async () => ({
  botUserId: "u-bot",
  botUsername: "theo",
  channelCache: new Map(),
  client: { setUrl: () => undefined, setToken: () => undefined },
  ws: {
    initialize: () => undefined,
    addMessageListener: () => undefined,
    removeMessageListener: () => undefined,
    close: () => undefined,
  },
}));

vi.mock("../src/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/client.js")>()),
  connectMattermost,
}));

// Imported AFTER vi.mock so the adapter resolves the mock.
const { MattermostAdapter } = await import("../src/adapter.js");

describe("MattermostAdapter — the connect guard is a guard, not a latch", () => {
  it("reconnects after an explicit disconnect", async () => {
    connectMattermost.mockClear();
    const adapter = new MattermostAdapter({ baseUrl: "https://mm.example.org", accessToken: "t" });

    expect(await adapter.connect()).toBe(true);
    await adapter.disconnect();
    expect(await adapter.connect()).toBe(true);

    expect(
      connectMattermost,
      "the second connect() never opened a connection",
    ).toHaveBeenCalledTimes(2);
    await adapter.disconnect();
  });

  it("a second connect() while already connected opens nothing", async () => {
    // The other direction of the same guard. Without it every `connect()` would open a fresh
    // websocket and leak the previous one — a latch failure and a leak failure look identical
    // from `connect()`'s return value, which is `true` either way.
    connectMattermost.mockClear();
    const adapter = new MattermostAdapter({ baseUrl: "https://mm.example.org", accessToken: "t" });

    expect(await adapter.connect()).toBe(true);
    expect(await adapter.connect()).toBe(true);

    expect(
      connectMattermost,
      "connect() opened a second connection over a live one",
    ).toHaveBeenCalledTimes(1);
    await adapter.disconnect();
  });
});
