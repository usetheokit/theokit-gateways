import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { type ListenableApp, listenerLifecycle } from "../../src/webhook/express-server.js";

const holders: Server[] = [];

afterEach(async () => {
  for (const server of holders.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/** A port another server already holds. */
async function takenPort(): Promise<number> {
  const holder = createServer();
  holders.push(holder);
  await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", () => resolve()));
  return (holder.address() as AddressInfo).port;
}

/** Express 5's `listen`: a listen error is passed to the callback. */
const express5Shaped: ListenableApp = {
  listen(port, cb) {
    const server = createServer();
    server.once("error", cb);
    return server.listen(port, "127.0.0.1", () => cb());
  },
};

/** Express 4's `listen`: a listen error is only emitted on the server. */
const express4Shaped: ListenableApp = {
  listen(port, cb) {
    return createServer().listen(port, "127.0.0.1", () => cb());
  },
};

describe("listenerLifecycle.start", () => {
  it.each([
    ["an Express 5 app", express5Shaped],
    ["an Express 4 app", express4Shaped],
  ])("rejects with the listen error when the port is taken, for %s", async (_name, app) => {
    const port = await takenPort();
    const lifecycle = listenerLifecycle({ app, port, injected: false });

    await expect(lifecycle.start()).rejects.toMatchObject({ code: "EADDRINUSE" });
    await lifecycle.stop();
  });

  it("starts, stops and starts again on a free port", async () => {
    const port = await takenPort();
    await new Promise<void>((resolve) => holders.pop()?.close(() => resolve()));
    const lifecycle = listenerLifecycle({ app: express5Shaped, port, injected: false });

    await lifecycle.start();
    await lifecycle.stop();
    await lifecycle.start();
    await lifecycle.stop();
  });
});
