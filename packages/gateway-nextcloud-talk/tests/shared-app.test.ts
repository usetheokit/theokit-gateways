/**
 * Two adapters in one process cannot both bind the default port. With `app`, the route is mounted
 * on an Express app the caller owns and listens with, and the adapter opens no port of its own.
 */

import type { Server } from "node:http";
import { connect as tcpConnect } from "node:net";

import type { MessageEvent } from "@theokit/gateway";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";

import { NextcloudTalkAdapter } from "../src/index.js";
import {
  BASE_URL,
  CREATE_BODY,
  freePort,
  SECRET,
  scriptedTalk,
  signedHeaders,
} from "./fixtures.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

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

describe("an adapter given an Express app", () => {
  it("mounts its route there, opens no port of its own, and delivers a signed message", async () => {
    const app = express();
    const ignoredPort = await freePort();
    const adapter = new NextcloudTalkAdapter({
      baseUrl: BASE_URL,
      secret: SECRET,
      fetch: scriptedTalk().fetch,
      app,
      port: ignoredPort,
    });
    cleanup.push(() => adapter.disconnect());
    const events: MessageEvent[] = [];
    adapter.onInbound(async (event) => {
      events.push(event);
    });

    expect(await adapter.connect()).toBe(true);
    expect(await listening(ignoredPort)).toBe(false);

    const port = await freePort();
    const server: Server = await new Promise((resolve) => {
      const started = app.listen(port, () => resolve(started));
    });
    cleanup.push(() => new Promise((resolve) => server.close(() => resolve())));
    const rawBody = JSON.stringify(CREATE_BODY);
    const { random, signature } = signedHeaders(rawBody);
    const answer = await fetch(`http://127.0.0.1:${port}/nextcloud-talk`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nextcloud-talk-random": random,
        "x-nextcloud-talk-signature": signature,
      },
      body: rawBody,
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(answer.status).toBe(200);
    expect(events).toHaveLength(1);
  });
});
