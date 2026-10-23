/**
 * `disconnect()` against a `connect()` still in flight, at each step `openSession()` waits on:
 * the capabilities read, and the listener's start. The listener is the real one; the module is
 * wrapped only to count servers and to hold `start()` until the test lets it go.
 */

import { connect as tcpConnect } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { NextcloudTalkAdapter, type NextcloudTalkAdapterOptions } from "../src/index.js";
import { BASE_URL, freePort, SECRET, scriptedTalk } from "./fixtures.js";

const servers = vi.hoisted(() => ({
  created: 0,
  startsAsked: 0,
  stopped: 0,
  startGate: undefined as Promise<void> | undefined,
}));

vi.mock("../src/webhook-server.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/webhook-server.js")>();
  return {
    ...real,
    createWebhookServer: async (opts: Parameters<typeof real.createWebhookServer>[0]) => {
      servers.created += 1;
      const server = await real.createWebhookServer(opts);
      return {
        async start(): Promise<void> {
          servers.startsAsked += 1;
          await servers.startGate;
          await server.start();
        },
        async stop(): Promise<void> {
          servers.stopped += 1;
          await server.stop();
        },
      };
    },
  };
});

const open: NextcloudTalkAdapter[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const adapter of open.splice(0)) await adapter.disconnect();
  servers.created = 0;
  servers.startsAsked = 0;
  servers.stopped = 0;
  servers.startGate = undefined;
});

/** Whether anything accepts a TCP connection on `port`. */
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

/** Wait until `condition` holds, polling every 5 ms, or fail naming what never happened. */
async function until(condition: () => boolean, what: string, deadlineMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > deadlineMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function adapterFor(overrides: Partial<NextcloudTalkAdapterOptions>): NextcloudTalkAdapter {
  const adapter = new NextcloudTalkAdapter({
    baseUrl: BASE_URL,
    secret: SECRET,
    fetch: scriptedTalk().fetch,
    ...overrides,
  });
  open.push(adapter);
  return adapter;
}

/** A fetch whose first capabilities read waits for `release()`; every other request goes through. */
function firstReadHeld(): {
  fetch: NextcloudTalkAdapterOptions["fetch"];
  release: () => void;
  asked: () => boolean;
} {
  const talk = scriptedTalk();
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  return {
    fetch: async (input, init) => {
      if (input.includes("/cloud/capabilities")) {
        reads += 1;
        if (reads === 1) await held;
      }
      return talk.fetch(input, init);
    },
    release: () => release(),
    asked: () => reads >= 1,
  };
}

describe("a disconnect that overtakes a connect", () => {
  it("during the capabilities read, creates no listener at all", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const read = firstReadHeld();
    const adapter = adapterFor({ port: await freePort(), fetch: read.fetch });

    const connecting = adapter.connect();
    await until(read.asked, "the capabilities read");
    await adapter.disconnect();
    read.release();

    expect(await connecting).toBe(false);
    expect(servers.created).toBe(0);
  });

  it("while the listener is starting, stops it and answers false", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let releaseStart: () => void = () => undefined;
    servers.startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const port = await freePort();
    const adapter = adapterFor({ port });

    const connecting = adapter.connect();
    await until(() => servers.startsAsked === 1, "the listener start");
    await adapter.disconnect();
    releaseStart();

    expect(await connecting).toBe(false);
    expect(servers.stopped).toBe(1);
    expect(await listening(port)).toBe(false);
  });

  it("a connect made after it starts a fresh session and answers true", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const read = firstReadHeld();
    const port = await freePort();
    const adapter = adapterFor({ port, fetch: read.fetch });

    const first = adapter.connect();
    await until(read.asked, "the capabilities read");
    await adapter.disconnect();
    const second = adapter.connect();
    read.release();

    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(servers.created).toBe(1);
    expect(await listening(port)).toBe(true);
  });
});
