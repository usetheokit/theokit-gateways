import { afterEach, describe, expect, it, vi } from "vitest";

import type { IrcAdapter } from "../src/index.js";
import { FakeIrcServer, type FakeServerScript } from "./fake-server.js";

const open: Array<{ server: FakeIrcServer; adapter: IrcAdapter }> = [];

async function setUp(
  script: FakeServerScript = {},
  overrides: Parameters<FakeIrcServer["adapter"]>[0] = {},
): Promise<{ server: FakeIrcServer; adapter: IrcAdapter }> {
  const server = await FakeIrcServer.start(script);
  const adapter = server.adapter(overrides);
  open.push({ server, adapter });
  return { server, adapter };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const { server, adapter } of open.splice(0)) {
    await adapter.disconnect();
    await server.close();
  }
});

describe("IrcAdapter.connect", () => {
  it("connect returns true after 001 and 366 for each channel", async () => {
    const { server, adapter } = await setUp({}, { channels: ["#theokit", "#second"] });

    expect(await adapter.connect()).toBe(true);

    expect(server.linesOf("NICK")).toEqual(["NICK theobot"]);
    expect(server.linesOf("USER")).toEqual(["USER theobot 0 * :theobot"]);
    expect(server.linesOf("JOIN")).toEqual(["JOIN #theokit,#second"]);
    expect(server.linesOf("CAP")).toEqual([]);
  });

  it("a nick in use is retried with an underscore", async () => {
    const { server, adapter } = await setUp({ nicksInUse: ["theobot", "theobot_"] });

    expect(await adapter.connect()).toBe(true);

    expect(server.linesOf("NICK")).toEqual(["NICK theobot", "NICK theobot_", "NICK theobot__"]);
  });

  it("gives up when the nick is still in use after 3 retries", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { server, adapter } = await setUp({
      nicksInUse: ["theobot", "theobot_", "theobot__", "theobot___"],
    });

    expect(await adapter.connect()).toBe(false);

    expect(server.linesOf("NICK")).toHaveLength(4);
  });

  it("a SASL success sends CAP END and then reaches 001", async () => {
    const { server, adapter } = await setUp(
      { sasl: "ok" },
      { saslAccount: "theoacct", saslPassword: "s3cret" },
    );

    expect(await adapter.connect()).toBe(true);

    const expected = Buffer.from("theoacct\0theoacct\0s3cret").toString("base64");
    expect(server.received.slice(0, 2)).toEqual(["CAP LS 302", "NICK theobot"]);
    expect(server.linesOf("CAP")).toEqual(["CAP LS 302", "CAP REQ :sasl", "CAP END"]);
    expect(server.linesOf("AUTHENTICATE")).toEqual([
      "AUTHENTICATE PLAIN",
      `AUTHENTICATE ${expected}`,
    ]);
  });

  it("a SASL failure returns false", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { server, adapter } = await setUp({ sasl: "fail" }, { saslPassword: "wrong" });

    expect(await adapter.connect()).toBe(false);

    expect(server.linesOf("JOIN")).toEqual([]);
  });

  it("sends PASS first when a server password is set, and returns false on 464", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { server, adapter } = await setUp({ rejectPassword: true }, { password: "bouncer-pw" });

    expect(await adapter.connect()).toBe(false);

    expect(server.received[0]).toBe("PASS :bouncer-pw");
  });

  it("returns false on ERROR from the server", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { server, adapter } = await setUp({ silent: true });
    const connecting = adapter.connect();
    await vi.waitFor(() => expect(server.linesOf("USER")).toHaveLength(1));

    server.push("ERROR :Closing Link: banned");

    expect(await connecting).toBe(false);
  });

  it("connect gives up after 10000 ms", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { server, adapter } = await setUp({ silent: true });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let settled: boolean | undefined;
    const connecting = adapter.connect().then((ok) => {
      settled = ok;
      return ok;
    });
    // vi.waitFor would advance the fake clock while it polls, so poll on setImmediate, which is
    // not faked: the server has to have read the handshake before the clock moves.
    while (server.linesOf("USER").length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(await connecting).toBe(false);
  });

  it("resolves false exactly once when the server closes the socket while connecting", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { server, adapter } = await setUp({ closeOnConnect: true });

    const results = await Promise.all([adapter.connect(), adapter.connect()]);

    expect(results).toEqual([false, false]);
    // The socket fires both close and, on some platforms, error; the attempt settles once.
    const failures = stderr.mock.calls.filter(([text]) => String(text).includes("connect failed"));
    expect(failures).toHaveLength(1);
    expect(server.connections).toBe(1);
  });

  it("finds sasl on the first line of a multi-line CAP LS", async () => {
    const { server, adapter } = await setUp(
      { capLs: ["* LS * :multi-prefix sasl=PLAIN", "* LS :away-notify account-tag"] },
      { saslPassword: "s3cret" },
    );

    expect(await adapter.connect()).toBe(true);

    expect(server.linesOf("CAP")).toEqual(["CAP LS 302", "CAP REQ :sasl", "CAP END"]);
  });

  it("refuses a multi-line CAP LS whose lines never offer sasl", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { server, adapter } = await setUp(
      { capLs: ["* LS * :multi-prefix", "* LS :away-notify"] },
      { saslPassword: "s3cret" },
    );

    expect(await adapter.connect()).toBe(false);

    expect(server.linesOf("CAP REQ")).toEqual([]);
  });

  it("returns false when SASL was asked for and the server welcomes without it", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { server, adapter } = await setUp({ noCap: true }, { saslPassword: "s3cret" });

    expect(await adapter.connect()).toBe(false);

    expect(server.linesOf("JOIN")).toEqual([]);
    expect(stderr.mock.calls.some(([text]) => String(text).includes("without SASL"))).toBe(true);
  });

  it("a disconnect while connecting leaves the adapter disconnected", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { server, adapter } = await setUp({ silent: true });
    const connecting = adapter.connect();
    await vi.waitFor(() => expect(server.linesOf("USER")).toHaveLength(1));

    await adapter.disconnect();
    // The welcome was already on its way when the caller gave up.
    server.push(":fake.irc.test 001 theobot :Welcome");
    server.push(":fake.irc.test 366 theobot #theokit :End of /NAMES list.");

    expect(await connecting).toBe(false);
    const sent = await adapter.sendMessage({
      channel: { id: "#theokit", type: "group" },
      text: "x",
    });
    expect(sent.error?.code).toBe("not_connected");
  });

  it("a connect made after a disconnect that overtook registration opens a fresh session", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { server, adapter } = await setUp({ silent: true });
    const first = adapter.connect();
    await vi.waitFor(() => expect(server.linesOf("USER")).toHaveLength(1));

    await adapter.disconnect();
    const second = adapter.connect();
    await vi.waitFor(() => expect(server.linesOf("USER")).toHaveLength(2));
    server.push(":fake.irc.test 001 theobot :Welcome");
    server.push(":fake.irc.test 366 theobot #theokit :End of /NAMES list.");

    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(server.connections).toBe(2);
  });

  it.each([
    ["password", { password: "pw\r\nQUIT" }],
    ["saslPassword", { saslPassword: "pw\nQUIT" }],
    ["saslAccount", { saslAccount: "acct\0other", saslPassword: "pw" }],
    ["realname", { realname: "Theo\r\nJOIN #x" }],
    ["username", { username: "theo\nQUIT" }],
    ["username", { username: "theo bot" }],
  ] as const)(
    "refuses a line break, NUL or space in %s at construction",
    async (field, override) => {
      const server = await FakeIrcServer.start();
      open.push({ server, adapter: server.adapter() });

      expect(() => server.adapter(override)).toThrow(new RegExp(`opts\\.${field}`));
    },
  );

  it("a second connect does not open a second session", async () => {
    const { server, adapter } = await setUp();

    expect(await adapter.connect()).toBe(true);
    expect(await adapter.connect()).toBe(true);

    expect(server.connections).toBe(1);
    expect(server.linesOf("NICK")).toHaveLength(1);
  });

  it("refuses a channel name without # or & at construction", async () => {
    const server = await FakeIrcServer.start();
    open.push({ server, adapter: server.adapter() });

    expect(() => server.adapter({ channels: ["theokit"] })).toThrow(/#name or &name/);
  });
});
