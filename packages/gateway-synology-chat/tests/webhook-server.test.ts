import { createServer, type Server } from "node:net";

import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SynologyChatAdapter } from "../src/adapter.js";
import { BOT_TOKEN, callbackForm, freePort, INCOMING_URL, ScriptedNas } from "./fixtures.js";

const open: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of open.splice(0)) await close();
  vi.restoreAllMocks();
});

async function listening(): Promise<{
  adapter: SynologyChatAdapter;
  url: string;
  handler: ReturnType<typeof vi.fn>;
}> {
  const port = await freePort();
  const adapter = new SynologyChatAdapter({
    botToken: BOT_TOKEN,
    incomingUrl: INCOMING_URL,
    port,
    fetch: new ScriptedNas().fetch,
  });
  const handler = vi.fn(async () => undefined);
  adapter.onInbound(handler);
  expect(await adapter.connect()).toBe(true);
  open.push(() => adapter.disconnect());
  return { adapter, url: `http://127.0.0.1:${port}/synology-chat`, handler };
}

function postForm(url: string, body: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

describe("the Synology Chat callback route", () => {
  it("answers 200 to a form-encoded callback and delivers it", async () => {
    const { url, handler } = await listening();
    const answer = await postForm(url, callbackForm({}));

    expect(answer.status).toBe(200);
    await until(() => handler.mock.calls.length === 1, "one delivery");
  });

  it("accepts the same callback as JSON (Q3)", async () => {
    const { url, handler } = await listening();
    const fields = Object.fromEntries(new URLSearchParams(callbackForm({})));
    const answer = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fields),
    });

    expect(answer.status).toBe(200);
    await until(() => handler.mock.calls.length === 1, "one delivery");
  });

  it("answers 401 to a token that differs only in its last byte, and never runs the handler", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { url, handler } = await listening();
    const answer = await postForm(url, callbackForm({ token: `${BOT_TOKEN.slice(0, -1)}d` }));

    expect(answer.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers 10 concurrent good callbacks 200 and 10 bad ones 401", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { url, handler } = await listening();
    const good = await Promise.all(
      Array.from({ length: 10 }, (_, i) => postForm(url, callbackForm({ post_id: `g${i}` }))),
    );
    const bad = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        postForm(url, callbackForm({ post_id: `b${i}`, token: "wrong" })),
      ),
    );

    expect(good.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(bad.map((r) => r.status)).toEqual(Array(10).fill(401));
    await until(() => handler.mock.calls.length === 10, "ten deliveries");
  });

  it("answers 413 to a body over 1 MiB", async () => {
    const { url, handler } = await listening();
    const answer = await postForm(url, callbackForm({ text: "x".repeat(1024 * 1024 + 1) }));

    expect(answer.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });

  it("mounts on a caller's express app and opens no port of its own", async () => {
    const app = express();
    const adapter = new SynologyChatAdapter({
      botToken: BOT_TOKEN,
      incomingUrl: INCOMING_URL,
      app,
      fetch: new ScriptedNas().fetch,
    });
    const handler = vi.fn(async () => undefined);
    adapter.onInbound(handler);
    expect(await adapter.connect()).toBe(true);
    open.push(() => adapter.disconnect());
    const port = await freePort();
    const server = app.listen(port, "127.0.0.1");
    open.push(() => new Promise((resolve) => server.close(() => resolve())));
    await new Promise((resolve) => server.once("listening", resolve));

    const answer = await postForm(`http://127.0.0.1:${port}/synology-chat`, callbackForm({}));
    expect(answer.status).toBe(200);
  });

  it("makes connect() answer false when its port is taken", async () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    const port = await freePort();
    const holder: Server = createServer();
    await new Promise<void>((resolve) => holder.listen(port, resolve));
    open.push(() => new Promise((resolve) => holder.close(() => resolve())));
    const adapter = new SynologyChatAdapter({
      botToken: BOT_TOKEN,
      incomingUrl: INCOMING_URL,
      port,
      fetch: new ScriptedNas().fetch,
    });

    expect(await adapter.connect()).toBe(false);
    expect(written.join("")).toContain("EADDRINUSE");
  });
});
