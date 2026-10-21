import { afterEach, describe, expect, it, vi } from "vitest";

import { type IrcAdapter, splitForIrc } from "../src/index.js";
import { FakeIrcServer, until } from "./fake-server.js";

const TARGET = "#theokit";
const COMMAND_LIMIT = 512;

/** `n` bytes of text whose 2-, 3- and 4-byte characters land on every offset in turn. */
function textOfBytes(n: number): string {
  const unit = ["a", "é", "€", "😀"];
  let text = "";
  let i = 0;
  while (Buffer.byteLength(text) < n) {
    const next = unit[i % unit.length] ?? "a";
    text += Buffer.byteLength(text + next) <= n ? next : "a";
    i += 1;
  }
  return text;
}

/** The command a chunk becomes on the wire, CRLF included. */
function wireBytes(chunk: string): number {
  return Buffer.byteLength(`PRIVMSG ${TARGET} :${chunk}\r\n`);
}

describe("splitForIrc", () => {
  it.each([1, 411, 412, 2000])("keeps every command within 512 bytes for %i bytes", (n) => {
    const text = textOfBytes(n);
    expect(Buffer.byteLength(text)).toBe(n);

    const chunks = splitForIrc(text, TARGET);

    for (const chunk of chunks) {
      expect(wireBytes(chunk) + 100).toBeLessThanOrEqual(COMMAND_LIMIT);
      // A cut inside a UTF-8 sequence would not survive the round trip.
      expect(Buffer.from(chunk, "utf8").toString("utf8")).toBe(chunk);
      expect(chunk).not.toMatch(/�/);
    }
    expect(chunks.join("")).toBe(text);
  });

  it("sends a line of exactly the budget as one command", () => {
    const budget = COMMAND_LIMIT - 2 - Buffer.byteLength(`PRIVMSG ${TARGET} :`) - 100;

    expect(splitForIrc("a".repeat(budget), TARGET)).toHaveLength(1);
    expect(splitForIrc("a".repeat(budget + 1), TARGET)).toHaveLength(2);
  });

  it("never cuts a surrogate pair", () => {
    const budget = COMMAND_LIMIT - 2 - Buffer.byteLength(`PRIVMSG ${TARGET} :`) - 100;
    const text = `${"a".repeat(budget - 2)}😀😀`;

    const chunks = splitForIrc(text, TARGET);

    expect(chunks).toEqual(["a".repeat(budget - 2), "😀😀"]);
  });

  it("splits on every line break and strips NUL and empty lines", () => {
    expect(splitForIrc("one\r\ntwo\n\nthree\rfour\0", TARGET)).toEqual([
      "one",
      "two",
      "three",
      "four",
    ]);
  });
});

describe("IrcAdapter.sendMessage", () => {
  const open: Array<{ server: FakeIrcServer; adapter: IrcAdapter }> = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const { server, adapter } of open.splice(0)) {
      await adapter.disconnect();
      await server.close();
    }
  });

  async function connected(): Promise<{ server: FakeIrcServer; adapter: IrcAdapter }> {
    const server = await FakeIrcServer.start();
    const adapter = server.adapter();
    open.push({ server, adapter });
    expect(await adapter.connect()).toBe(true);
    return { server, adapter };
  }

  it("a two-line reply is two PRIVMSG commands and no sent line contains CR, LF or NUL", async () => {
    const { server, adapter } = await connected();

    const result = await adapter.sendMessage({
      channel: { id: TARGET, type: "group" },
      text: "first line\r\nsecond\0 line",
    });

    expect(result).toEqual({ ok: true });
    await until(() => server.linesOf("PRIVMSG").length === 2, "two PRIVMSG lines");
    expect(server.linesOf("PRIVMSG")).toEqual([
      "PRIVMSG #theokit :first line",
      "PRIVMSG #theokit :second line",
    ]);
    for (const line of server.received) expect(line).not.toMatch(/[\r\n\0]/);
  });

  it("keeps two concurrent sends in call order, never interleaved", async () => {
    const { server, adapter } = await connected();
    const long = "x".repeat(900);

    await Promise.all([
      adapter.sendMessage({ channel: { id: TARGET, type: "group" }, text: `A${long}` }),
      adapter.sendMessage({ channel: { id: TARGET, type: "group" }, text: `B${long}` }),
    ]);

    await until(() => server.linesOf("PRIVMSG").length >= 6, "both messages");
    const order = server.linesOf("PRIVMSG").map((line) => line.slice("PRIVMSG #theokit :".length));
    const joined = order.join("");
    expect(joined).toBe(`A${long}B${long}`);
  });

  it("returns empty_text before any state check", async () => {
    const server = await FakeIrcServer.start();
    const adapter = server.adapter();
    open.push({ server, adapter });

    const result = await adapter.sendMessage({ channel: { id: TARGET, type: "group" }, text: "" });

    expect(result.error?.code).toBe("empty_text");
  });

  it("returns not_connected without a socket", async () => {
    const server = await FakeIrcServer.start();
    const adapter = server.adapter();
    open.push({ server, adapter });

    const result = await adapter.sendMessage({
      channel: { id: TARGET, type: "group" },
      text: "hi",
    });

    expect(result.error?.code).toBe("not_connected");
  });

  it("refuses a target that would inject a second command", async () => {
    const { adapter } = await connected();

    const result = await adapter.sendMessage({
      channel: { id: "#a :x\r\nQUIT", type: "group" },
      text: "hi",
    });

    expect(result.error?.code).toBe("invalid_target");
  });

  it.each([
    ["too long to leave room for any text", `#${"a".repeat(400)}`],
    ["starting with a colon", ":#theokit"],
  ])("returns invalid_target, not a throw, for a target %s", async (_why, target) => {
    const { adapter } = await connected();

    const result = await adapter.sendMessage({
      channel: { id: target, type: "group" },
      text: "hi",
    });

    expect(result.error?.code).toBe("invalid_target");
  });

  it("strips markdown markers and sends html unchanged with one warning", async () => {
    const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { server, adapter } = await connected();

    await adapter.sendMessage({
      channel: { id: TARGET, type: "group" },
      text: "**bold** move",
      format: "markdown",
    });
    await adapter.sendMessage({
      channel: { id: TARGET, type: "group" },
      text: "<b>x</b>",
      format: "html",
    });
    await adapter.sendMessage({
      channel: { id: TARGET, type: "group" },
      text: "<i>y</i>",
      format: "html",
    });

    await until(() => server.linesOf("PRIVMSG").length === 3, "three PRIVMSG lines");
    expect(server.linesOf("PRIVMSG")).toEqual([
      "PRIVMSG #theokit :bold move",
      "PRIVMSG #theokit :<b>x</b>",
      "PRIVMSG #theokit :<i>y</i>",
    ]);
    expect(warn.mock.calls.filter(([text]) => String(text).includes('format="html"'))).toHaveLength(
      1,
    );
  });

  it("logs a throwing handler as handler threw and keeps reading", async () => {
    const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { server, adapter } = await connected();
    let calls = 0;
    adapter.onInbound(async () => {
      calls += 1;
      throw new Error("boom");
    });

    server.push(":ana!a@host PRIVMSG #theokit :one");
    server.push(":ana!a@host PRIVMSG #theokit :two");

    await until(() => calls === 2, "two handler calls");
    expect(warn.mock.calls.some(([text]) => String(text).includes("handler threw"))).toBe(true);
  });
});
