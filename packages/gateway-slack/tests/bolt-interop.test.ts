/**
 * The shape of `@slack/bolt` as this adapter imports it.
 *
 * Deliberately does NOT mock Bolt — every other suite here does, which is right
 * for behaviour but means none of them can see the one thing that actually
 * broke: how the module is imported.
 *
 * Bolt v3 was CommonJS with the namespace as its default export, so
 * `import { App }` type-checked and was `undefined` at runtime; the adapter used
 * `import bolt from "@slack/bolt"; const { App } = bolt;` for that reason. Bolt
 * v5 makes the App class the default export and also exports it by name, so the
 * v3 form now yields `undefined` instead. The two are mutually exclusive, which
 * is why the peer range names one of them rather than both (#31).
 *
 * A mocked suite is blind to that. This asserts against the real package, so a
 * future version bump that flips the module shape again fails here rather than
 * in a consumer's process.
 */

import { App } from "@slack/bolt";
import { describe, expect, it } from "vitest";

describe("@slack/bolt module interop", () => {
  it("exports App as a constructible named export", () => {
    expect(typeof App).toBe("function");
    expect(App.prototype).toBeDefined();
  });

  it("constructs an App without opening a socket", () => {
    // The constructor only builds the receiver; nothing dials out until
    // start(). If a version bump ever changes that, this test hangs or throws
    // instead of a live suite discovering it against the real Slack API.
    const app = new App({
      token: "xoxb-not-a-real-token",
      appToken: "xapp-not-a-real-token",
      socketMode: true,
    });

    expect(app).toBeInstanceOf(App);
    expect(typeof app.start).toBe("function");
    expect(typeof app.stop).toBe("function");
    expect(typeof app.event).toBe("function");
  });

  it("exposes the web client surface the adapter calls", () => {
    // `auth.test` (D277 bot id cache) and `chat.postMessage` (D272 outbound)
    // are the only two Web API methods this adapter uses. They are asserted
    // here so a client restructure is caught offline.
    const app = new App({
      token: "xoxb-not-a-real-token",
      appToken: "xapp-not-a-real-token",
      socketMode: true,
    });

    expect(typeof app.client.auth.test).toBe("function");
    expect(typeof app.client.chat.postMessage).toBe("function");
  });

  it("no longer pulls in the finity state machine", async () => {
    // THE regression behind #31. Bolt v3 reached @slack/socket-mode 1.x, whose
    // finity state machine threw `Unhandled event 'server explicit disconnect'
    // in state 'connecting'` when Slack sent its routine connection-refresh
    // while the socket was still opening. finity throws from an async websocket
    // handler, so it surfaced as an unhandled rejection that killed the process
    // AFTER the tests had passed — a red job with a green suite.
    //
    // socket-mode 2.x dropped finity entirely and 3.x handles the same message
    // by calling `websocket.disconnect()`. Asserting the dependency is gone is
    // how this stays fixed: a downgrade of the peer range would silently
    // reintroduce a defect no adapter-level test can reproduce, because the
    // throw happens inside a transitive package.
    const { createRequire } = await import("node:module");
    const requireHere = createRequire(import.meta.url);

    // Resolve socket-mode THROUGH Bolt, not from here. pnpm isolates
    // node_modules, so this package can only see `@slack/bolt`; asking for
    // `@slack/socket-mode` directly fails under plain Node and succeeds under
    // Vitest's resolver, which would make this assertion depend on which
    // runner executed it. Walking the real edge — the socket-mode that the
    // Bolt we installed actually uses — is deterministic and is also the
    // relationship the bug travelled along.
    const boltManifestPath = requireHere.resolve("@slack/bolt/package.json");
    const requireFromBolt = createRequire(boltManifestPath);
    const socketMode = requireFromBolt("@slack/socket-mode/package.json") as {
      version: string;
      dependencies?: Record<string, string>;
    };

    expect(Number.parseInt(socketMode.version, 10)).toBeGreaterThanOrEqual(2);
    expect(Object.keys(socketMode.dependencies ?? {})).not.toContain("finity");
  });
});
