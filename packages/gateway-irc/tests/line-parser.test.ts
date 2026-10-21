import type { MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it } from "vitest";

import { type IrcAdapter, parseIrcLine, privmsgToMessageEvent } from "../src/index.js";
import { FakeIrcServer, until } from "./fake-server.js";

describe("parseIrcLine", () => {
  it("keeps colons in the trailing parameter", () => {
    const line = parseIrcLine(":ana!a@host PRIVMSG #theokit :see https://x.test: 10:30 :)");

    expect(line).toEqual({
      tags: {},
      prefix: "ana!a@host",
      command: "PRIVMSG",
      params: ["#theokit", "see https://x.test: 10:30 :)"],
    });
  });

  it("reads IRCv3 tags, unescaping their values", () => {
    const line = parseIrcLine(
      "@msgid=abc123;time=2026-10-21T05:30:00.000Z;+note=a\\sb\\:c;flag :ana!a@h PRIVMSG #t :hi",
    );

    expect(line?.tags).toEqual({
      msgid: "abc123",
      time: "2026-10-21T05:30:00.000Z",
      "+note": "a b;c",
      flag: "",
    });
    expect(line?.command).toBe("PRIVMSG");
  });

  it("reads a line with no prefix and middle parameters only", () => {
    expect(parseIrcLine("PING irc.example.net")).toEqual({
      tags: {},
      command: "PING",
      params: ["irc.example.net"],
    });
  });

  it("reads a numeric with an empty trailing parameter", () => {
    expect(parseIrcLine(":srv 001 theobot :")?.params).toEqual(["theobot", ""]);
  });

  it("returns undefined for an empty line", () => {
    expect(parseIrcLine("")).toBeUndefined();
    expect(parseIrcLine("@tag=1 ")).toBeUndefined();
  });
});

describe("privmsgToMessageEvent", () => {
  const OWN = "theobot";

  it("an ACTION is delivered with irc.action", () => {
    const raw = ":ana!a@host PRIVMSG #theokit :\u0001ACTION waves\u0001";
    const event = privmsgToMessageEvent(parseIrcLine(raw)!, raw, OWN, 1000, 1);

    expect(event?.text).toBe("waves");
    expect(event?.irc.action).toBe(true);
    expect(event?.channel).toEqual({ id: "#theokit", type: "group" });
  });

  it("a VERSION request is dropped", () => {
    const raw = ":ana!a@host PRIVMSG theobot :\u0001VERSION\u0001";

    expect(privmsgToMessageEvent(parseIrcLine(raw)!, raw, OWN, 1000, 1)).toBeUndefined();
  });

  it("its own nick is dropped, compared case-insensitively", () => {
    const raw = ":TheoBot!a@host PRIVMSG #theokit :echo";

    expect(privmsgToMessageEvent(parseIrcLine(raw)!, raw, OWN, 1000, 1)).toBeUndefined();
  });

  it("a message to the adapter's nick is a dm from the sender", () => {
    const raw = ":ana!a@host PRIVMSG theobot :hello";
    const event = privmsgToMessageEvent(parseIrcLine(raw)!, raw, OWN, 1000, 7);

    expect(event?.channel).toEqual({ id: "ana", type: "dm" });
    expect(event?.sender).toEqual({ id: "ana", displayName: "ana" });
    expect(event?.id).toBe("ana:1000:7");
    expect(event?.irc).toEqual({ target: "theobot", nick: "ana", action: false, tags: {}, raw });
  });

  it("takes the msgid tag as the event id when the server sent one", () => {
    const raw = "@msgid=xyz :ana!a@host PRIVMSG &local :hi";
    const event = privmsgToMessageEvent(parseIrcLine(raw)!, raw, OWN, 1000, 1);

    expect(event?.id).toBe("xyz");
    expect(event?.channel.type).toBe("group");
  });

  it("drops a message with no text", () => {
    const raw = ":ana!a@host PRIVMSG #theokit :";

    expect(privmsgToMessageEvent(parseIrcLine(raw)!, raw, OWN, 1000, 1)).toBeUndefined();
  });
});

describe("IrcAdapter on a live connection", () => {
  const open: Array<{ server: FakeIrcServer; adapter: IrcAdapter }> = [];

  afterEach(async () => {
    for (const { server, adapter } of open.splice(0)) {
      await adapter.disconnect();
      await server.close();
    }
  });

  async function connected(): Promise<{
    server: FakeIrcServer;
    adapter: IrcAdapter;
    events: MessageEvent[];
  }> {
    const server = await FakeIrcServer.start();
    const adapter = server.adapter();
    open.push({ server, adapter });
    const events: MessageEvent[] = [];
    adapter.onInbound(async (event) => {
      events.push(event);
    });
    expect(await adapter.connect()).toBe(true);
    return { server, adapter, events };
  }

  it("answers PING with PONG", async () => {
    const { server } = await connected();

    server.push("PING :token-42");

    await until(() => server.linesOf("PONG").length === 1, "a PONG");
    expect(server.linesOf("PONG")).toEqual(["PONG :token-42"]);
  });

  it("delivers a channel message from another nick to the handler", async () => {
    const { server, events } = await connected();

    server.push(":ana!a@host PRIVMSG #theokit :hello there");

    await until(() => events.length === 1, "an inbound event");
    expect(events[0]?.platform).toBe("irc");
    expect(events[0]?.text).toBe("hello there");
  });

  it("drops a message its own nick sent, after the server renamed it", async () => {
    const { server, events } = await connected();

    server.push(":theobot!u@h NICK :theobot2");
    server.push(":theobot2!u@h PRIVMSG #theokit :my own echo");
    server.push(":ana!a@host PRIVMSG #theokit :after");

    await until(() => events.length === 1, "the message after the echo");
    expect(events.map((e) => e.text)).toEqual(["after"]);
  });
});
