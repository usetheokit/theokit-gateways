import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import {
  type JsonRpcChild,
  JsonRpcLineClient,
  type RpcNotification,
} from "../../src/adapter/json-rpc-line.js";

function setup() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const events = new EventEmitter();
  const written: string[] = [];
  stdin.on("data", (d: Buffer) => written.push(d.toString()));
  const child = Object.assign(events, { stdin, stdout, stderr, kill: () => true });
  const notes: RpcNotification[] = [];
  const closed: string[] = [];
  const client = new JsonRpcLineClient(
    child as unknown as JsonRpcChild,
    "test",
    (n) => notes.push(n),
    (r) => closed.push(r),
  );
  const send = (line: string) => stdout.write(`${line}\n`);
  return { client, events, send, notes, closed, written };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("JsonRpcLineClient", () => {
  it("resolves a result and writes a framed request", async () => {
    const t = setup();
    const p = t.client.request("ping", { a: 1 }, 1000);
    await tick();
    expect(JSON.parse(t.written.join(""))).toEqual({
      jsonrpc: "2.0",
      method: "ping",
      params: { a: 1 },
      id: 1,
    });
    t.send(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "pong" }));
    expect(await p).toEqual({ kind: "result", result: "pong" });
  });

  it("skips null, number, string, array and non-JSON lines", async () => {
    const t = setup();
    const p = t.client.request("x", {}, 1000);
    for (const l of ["null", "42", '"x"', "[]", "not json", ""]) t.send(l);
    t.send(JSON.stringify({ id: 1, result: 7 }));
    expect(await p).toEqual({ kind: "result", result: 7 });
  });

  it("keeps error data", async () => {
    const t = setup();
    const p = t.client.request("x", {}, 1000);
    t.send(JSON.stringify({ id: 1, error: { code: -32000, message: "bad", data: { k: 1 } } }));
    expect(await p).toEqual({ kind: "error", code: -32000, message: "bad", data: { k: 1 } });
  });

  it("delivers notifications", async () => {
    const t = setup();
    t.send(JSON.stringify({ method: "receive", params: { m: 1 } }));
    await tick();
    expect(t.notes).toEqual([{ method: "receive", params: { m: 1 } }]);
  });

  it("times out", async () => {
    vi.useFakeTimers();
    const t = setup();
    const p = t.client.request("x", {}, 50);
    await vi.advanceTimersByTimeAsync(60);
    expect(await p).toEqual({ kind: "timeout" });
    vi.useRealTimers();
  });

  it("settles every pending request as disconnected when the child closes", async () => {
    const t = setup();
    const a = t.client.request("a", {}, 1000);
    const b = t.client.request("b", {}, 1000);
    t.events.emit("close", 1, null);
    expect(await a).toEqual({ kind: "disconnected" });
    expect(await b).toEqual({ kind: "disconnected" });
    expect(t.closed).toEqual(["exited with code 1"]);
    expect(await t.client.request("c", {}, 1000)).toEqual({ kind: "disconnected" });
  });
});
