import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { GatewayRunner, type MessageEvent } from "@theokit/gateway";
import { describe, expect, it } from "vitest";
import { parseRaftWake, RaftAdapter, type RaftChild, type RaftSpawn } from "../src/index.js";

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  killed = false;
  written = "";
  constructor() {
    super();
    this.stdin.on("data", (c: Buffer) => {
      this.written += c.toString();
    });
  }
  kill(): boolean {
    this.killed = true;
    this.emit("close", null);
    return true;
  }
}

function harness(replyExit = 0) {
  const spawns: { command: string; args: readonly string[]; child: FakeChild }[] = [];
  const spawn: RaftSpawn = (command, args) => {
    const child = new FakeChild();
    spawns.push({ command, args, child });
    if (args[0] === "reply") {
      child.stdin.on("finish", () => setImmediate(() => child.emit("close", replyExit)));
    }
    return child as unknown as RaftChild;
  };
  return { spawns, adapter: new RaftAdapter({ spawn }) };
}

const wake = (o: object) => `${JSON.stringify(o)}\n`;
const tick = () => new Promise((r) => setTimeout(r, 20));

describe("parseRaftWake", () => {
  it("maps a wake to a dm event", () => {
    const e = parseRaftWake('{"id":"w1","from":"u1","text":"hi","conversation":"c1","ts":5}');
    expect(e).toMatchObject({
      id: "w1",
      platform: "raft",
      sender: { id: "u1" },
      channel: { id: "c1", type: "dm" },
      text: "hi",
      receivedAt: 5,
    });
  });
  it("defaults the conversation to the sender and rejects gaps", () => {
    expect(parseRaftWake('{"id":1,"from":"u","text":"x"}')?.channel.id).toBe("u");
    expect(parseRaftWake("nope")).toBeUndefined();
    expect(parseRaftWake('{"id":"1","from":"u"}')).toBeUndefined();
    expect(parseRaftWake("[]")).toBeUndefined();
  });
});

describe("RaftAdapter", () => {
  it("connect runs the wake bridge and a wake reaches onMessage", async () => {
    const { adapter, spawns } = harness();
    const events: MessageEvent[] = [];
    const runner = new GatewayRunner({
      adapters: [adapter],
      handler: async (e) => {
        events.push(e);
      },
    });
    await runner.start();
    expect(spawns[0]?.command).toBe("raft");
    expect(spawns[0]?.args).toEqual(["wake", "--json"]);
    const out = spawns[0]?.child.stdout;
    out?.write(wake({ id: "w1", from: "u1", text: "wake up" }).slice(0, 10));
    out?.write(`${wake({ id: "w1", from: "u1", text: "wake up" }).slice(10)}garbage\n`);
    out?.write(wake({ id: "w1", from: "u1", text: "wake up" }));
    await tick();
    expect(events.map((e) => e.text)).toEqual(["wake up"]);
    await runner.stop();
    expect(spawns[0]?.child.killed).toBe(true);
  });

  it("sends a reply through the reply command with the text on stdin", async () => {
    const { adapter, spawns } = harness();
    expect(await adapter.connect()).toBe(true);
    const res = await adapter.sendMessage({
      channel: { id: "c1", type: "dm" },
      text: "**hi**",
      format: "markdown",
    });
    expect(res.ok).toBe(true);
    const reply = spawns[1];
    expect(reply?.args).toEqual(["reply", "--to", "c1"]);
    expect(reply?.child.written).toBe("hi");
    await adapter.disconnect();
  });

  it("reports a failing reply", async () => {
    const { adapter } = harness(3);
    await adapter.connect();
    const res = await adapter.sendMessage({ channel: { id: "c1", type: "dm" }, text: "x" });
    expect(res).toMatchObject({ ok: false, error: { code: "raft_send_failed" } });
    await adapter.disconnect();
  });

  it("refuses before connect, empty text, empty channel and attachments", async () => {
    const { adapter } = harness();
    const base = { channel: { id: "c", type: "dm" as const }, text: "x" };
    expect((await adapter.sendMessage(base)).error?.code).toBe("not_connected");
    await adapter.connect();
    expect((await adapter.sendMessage({ ...base, text: "" })).error?.code).toBe("empty_text");
    expect(
      (await adapter.sendMessage({ ...base, channel: { id: "", type: "dm" } })).error?.code,
    ).toBe("invalid_channel");
    expect(
      (
        await adapter.sendMessage({
          ...base,
          attachments: [{ kind: "image", url: "u" }] as never,
        })
      ).error?.code,
    ).toBe("attachments_unsupported");
    await adapter.disconnect();
  });

  it("connect answers false when the CLI cannot run, and not_connected after it exits", async () => {
    const missing = new RaftAdapter({
      spawn: () => {
        const c = new FakeChild();
        setImmediate(() => c.emit("error", new Error("spawn raft ENOENT")));
        return c as unknown as RaftChild;
      },
    });
    expect(await missing.connect()).toBe(false);

    const { adapter, spawns } = harness();
    await adapter.connect();
    spawns[0]?.child.emit("close", 1);
    const res = await adapter.sendMessage({ channel: { id: "c", type: "dm" }, text: "x" });
    expect(res.error?.code).toBe("not_connected");
  });
});
