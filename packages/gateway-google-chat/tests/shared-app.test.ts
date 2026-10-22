/**
 * Two adapters in one process cannot both bind the default port. With `app`, the route is mounted
 * on an Express app the caller owns and listens with, and the adapter opens no port of its own.
 */

import type { Server } from "node:http";
import { createServer, connect as tcpConnect } from "node:net";

import express from "express";
import { afterEach, describe, expect, it } from "vitest";

import { GoogleChatAdapter } from "../src/index.js";
import {
  APP_PRIVATE_KEY_PEM,
  AUDIENCE,
  NOW_MS,
  SERVICE_ACCOUNT,
  scriptedGoogle,
} from "./fixtures.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        resolve(typeof address === "object" && address !== null ? address.port : 0),
      );
    });
  });
}

async function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = tcpConnect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function adapterOn(app: express.Express, path: string, port: number): GoogleChatAdapter {
  const adapter = new GoogleChatAdapter({
    serviceAccountEmail: SERVICE_ACCOUNT,
    privateKey: APP_PRIVATE_KEY_PEM,
    audience: AUDIENCE,
    now: () => NOW_MS,
    fetch: scriptedGoogle().fetch,
    app,
    path,
    port,
  });
  cleanup.push(() => adapter.disconnect());
  return adapter;
}

describe("an adapter given an Express app", () => {
  it("mounts its route there and opens no port of its own, so two adapters share one listener", async () => {
    const app = express();
    const ignoredPort = await freePort();
    const first = adapterOn(app, "/chat-a", ignoredPort);
    const second = adapterOn(app, "/chat-b", ignoredPort);

    expect(await first.connect()).toBe(true);
    expect(await second.connect()).toBe(true);
    expect(await listening(ignoredPort)).toBe(false);

    const port = await freePort();
    const server: Server = await new Promise((resolve) => {
      const started = app.listen(port, () => resolve(started));
    });
    cleanup.push(() => new Promise((resolve) => server.close(() => resolve())));
    const answers = await Promise.all(
      ["/chat-a", "/chat-b"].map((path) =>
        fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", body: "{}" }),
      ),
    );

    // 401 is the route's own answer to a request with no bearer token; an unmounted path is 404.
    expect(answers.map((answer) => answer.status)).toEqual([401, 401]);
  });

  it("without one, a second adapter on a port the first holds answers false", async () => {
    const stderr: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((text: string) => {
      stderr.push(String(text));
      return true;
    }) as typeof process.stderr.write;
    cleanup.push(async () => {
      process.stderr.write = write;
    });
    const port = await freePort();
    const make = (): GoogleChatAdapter => {
      const adapter = new GoogleChatAdapter({
        serviceAccountEmail: SERVICE_ACCOUNT,
        privateKey: APP_PRIVATE_KEY_PEM,
        audience: AUDIENCE,
        now: () => NOW_MS,
        fetch: scriptedGoogle().fetch,
        port,
      });
      cleanup.push(() => adapter.disconnect());
      return adapter;
    };

    expect(await make().connect()).toBe(true);
    expect(await make().connect()).toBe(false);
    expect(stderr.some((line) => line.includes("EADDRINUSE"))).toBe(true);
  });
});
