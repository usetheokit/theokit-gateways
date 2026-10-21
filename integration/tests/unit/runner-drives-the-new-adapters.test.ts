/**
 * `GatewayRunner` over each new adapter, offline (FR-008, AC-008).
 *
 * The gateway half of "the app replies on <platform>": one inbound message goes through the
 * runner, the handler replies through `ctx.reply`, and exactly one platform call carries the reply
 * while `post_outbound` fires exactly once for the member's key. A reply written straight to the
 * adapter, around the runner, reaches the platform and leaves `post_outbound` at zero: the hook
 * observes the runner, not the transport.
 *
 * Every transport here is scripted in this file and handed to the adapter through its own public
 * seam, so nothing spawns a process, opens a remote socket or calls a real endpoint. The Google Chat
 * adapter binds its webhook listener on a port the system picks, and nothing dials it; the IRC
 * adapter dials a scripted server on a local port.
 */

import { generateKeyPairSync, sign } from "node:crypto";
import { EventEmitter } from "node:events";
import { createServer, type Server, type Socket } from "node:net";
import { PassThrough } from "node:stream";

import {
  type BasePlatformAdapter,
  type GatewayHook,
  GatewayRunner,
  type PlatformName,
} from "@theokit/gateway";
import { GoogleChatAdapter } from "@theokit/gateway-google-chat";
import { IMessageAdapter, type ChildLike as IMessageChild } from "@theokit/gateway-imessage";
import { IrcAdapter } from "@theokit/gateway-irc";
import { type ChildLike, SignalAdapter } from "@theokit/gateway-signal";
import { afterEach, describe, expect, it } from "vitest";

/** One new platform, its adapter over a scripted transport, and what the transport saw. */
interface Member {
  readonly key: PlatformName;
  readonly adapter: BasePlatformAdapter;
  /** A channel id this platform accepts for a reply written straight to the adapter. */
  readonly peerChannelId: string;
  /** Feed one inbound text message to the adapter, as the platform would. */
  inject(text: string): Promise<void>;
  /** The texts the transport was asked to send, in order. */
  sent(): readonly string[];
  /** Release anything the transport holds open. */
  close(): Promise<void>;
  /**
   * Resolve once everything the adapter has written so far has reached the transport. Members
   * whose transport records synchronously have nothing to wait for.
   */
  flush?(): Promise<void>;
}

/** A signal-cli child that answers `listGroups` and every `send`, and can push a `receive`. */
class ScriptedSignalCli extends EventEmitter implements ChildLike {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly sends: string[] = [];
  private buffered = "";

  constructor() {
    super();
    this.stdin.on("data", (chunk: Buffer) => {
      this.buffered += chunk.toString("utf8");
      for (let at = this.buffered.indexOf("\n"); at !== -1; at = this.buffered.indexOf("\n")) {
        this.onRequest(this.buffered.slice(0, at));
        this.buffered = this.buffered.slice(at + 1);
      }
    });
  }

  receive(text: string): void {
    const envelope = {
      sourceNumber: "+5511988887777",
      sourceUuid: "uuid-peer",
      timestamp: Date.now(),
      dataMessage: { timestamp: Date.now(), message: text },
    };
    this.line({ jsonrpc: "2.0", method: "receive", params: { envelope } });
  }

  kill(): boolean {
    queueMicrotask(() => {
      this.stdout.end();
      this.emit("close", null, "SIGTERM");
    });
    return true;
  }

  private onRequest(raw: string): void {
    const request = JSON.parse(raw) as { id: number; method: string; params: { message?: string } };
    if (request.method === "send") this.sends.push(request.params.message ?? "");
    const result = request.method === "send" ? { timestamp: this.sends.length } : [];
    this.line({ jsonrpc: "2.0", id: request.id, result });
  }

  private line(message: unknown): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }
}

function signalMember(): Member {
  const child = new ScriptedSignalCli();
  const adapter = new SignalAdapter({ account: "+5511999990000", spawn: () => child });
  return {
    key: "signal",
    adapter,
    peerChannelId: "+5511988887777",
    inject: async (text) => child.receive(text),
    sent: () => child.sends,
    close: async () => adapter.disconnect(),
  };
}

/** The one chat the scripted imsg knows: inbound rows come from it and replies go to it. */
const IMSG_CHAT_ID = 7;

/** An `imsg rpc` child that answers `watch.subscribe` and every `send`, and can push a `message`. */
class ScriptedImsg extends EventEmitter implements IMessageChild {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly sends: string[] = [];
  private buffered = "";
  private rowId = 0;

  constructor() {
    super();
    this.stdin.on("data", (chunk: Buffer) => {
      this.buffered += chunk.toString("utf8");
      for (let at = this.buffered.indexOf("\n"); at !== -1; at = this.buffered.indexOf("\n")) {
        this.onRequest(this.buffered.slice(0, at));
        this.buffered = this.buffered.slice(at + 1);
      }
    });
    // imsg ends when its stdin closes, which is how the adapter's disconnect() asks it to.
    this.stdin.on("finish", () => this.kill());
  }

  message(text: string): void {
    this.rowId += 1;
    const message = {
      id: this.rowId,
      chat_id: IMSG_CHAT_ID,
      guid: `guid-${this.rowId}`,
      sender: "+5511988887777",
      is_from_me: false,
      text,
      is_group: false,
      participants: ["+5511988887777"],
    };
    this.line({ jsonrpc: "2.0", method: "message", params: { subscription: 1, message } });
  }

  kill(): boolean {
    queueMicrotask(() => {
      this.stdout.end();
      this.emit("close", null, "SIGTERM");
    });
    return true;
  }

  private onRequest(raw: string): void {
    const request = JSON.parse(raw) as { id: number; method: string; params: { text?: string } };
    if (request.method === "send") this.sends.push(request.params.text ?? "");
    const result =
      request.method === "send"
        ? { ok: true, guid: `sent-${this.sends.length}` }
        : { subscription: 1 };
    this.line({ jsonrpc: "2.0", id: request.id, result });
  }

  private line(message: unknown): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }
}

function imessageMember(): Member {
  const child = new ScriptedImsg();
  const adapter = new IMessageAdapter({ spawn: () => child });
  return {
    key: "imessage",
    adapter,
    peerChannelId: String(IMSG_CHAT_ID),
    inject: async (text) => child.message(text),
    sent: () => child.sends,
    close: async () => adapter.disconnect(),
  };
}

/** The Chat app's endpoint URL, which every inbound token must name as its audience. */
const CHAT_AUDIENCE = "https://bot.example.com/google-chat";
const CHAT_SPACE = "spaces/AAAA-test";
const GOOGLE_KID = "google-key-1";
// Made once for the file: an RSA key takes tens of milliseconds to generate.
const googleSigner = generateKeyPairSync("rsa", { modulusLength: 2048 });
const chatAppKey = generateKeyPairSync("rsa", { modulusLength: 2048 });

/** An ID token as Chat sends it, signed by the scripted Google's key. */
function chatIdToken(): string {
  const b64 = (value: string | Buffer): string => Buffer.from(value).toString("base64url");
  const nowS = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: GOOGLE_KID };
  const claims = {
    iss: "https://accounts.google.com",
    aud: CHAT_AUDIENCE,
    email: "chat@system.gserviceaccount.com",
    email_verified: true,
    iat: nowS - 10,
    exp: nowS + 3600,
  };
  const signed = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(claims))}`;
  return `${signed}.${b64(sign("RSA-SHA256", Buffer.from(signed), googleSigner.privateKey))}`;
}

/** Google's key set, its token endpoint and the Chat API, answered in process. */
function scriptedGoogle(): {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  sends: string[];
} {
  const sends: string[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      const jwk = googleSigner.publicKey.export({ format: "jwk" }) as Record<string, unknown>;
      return Response.json(
        { keys: [{ ...jwk, kid: GOOGLE_KID, alg: "RS256", use: "sig" }] },
        { headers: { "cache-control": "public, max-age=3600" } },
      );
    }
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "token-1", expires_in: 3600, token_type: "Bearer" });
    }
    if (url === `https://chat.googleapis.com/v1/${CHAT_SPACE}/messages`) {
      sends.push((JSON.parse(String(init?.body)) as { text: string }).text);
      return Response.json({ name: `${CHAT_SPACE}/messages/OUT${sends.length}` });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };
  return { fetch, sends };
}

function googleChatMember(): Member {
  const google = scriptedGoogle();
  const adapter = new GoogleChatAdapter({
    serviceAccountEmail: "theo-bot@theo-dev.iam.gserviceaccount.com",
    privateKey: chatAppKey.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    audience: CHAT_AUDIENCE,
    // Port 0: the operating system picks a free one. The case posts through handleRequest, the
    // seam the route calls, so it never needs to know which.
    port: 0,
    fetch: google.fetch,
  });
  let messageNumber = 0;
  return {
    key: "google_chat",
    adapter,
    peerChannelId: CHAT_SPACE,
    inject: async (text) => {
      messageNumber += 1;
      const event = {
        type: "MESSAGE",
        space: { name: CHAT_SPACE, spaceType: "DIRECT_MESSAGE" },
        user: { name: "users/1234", displayName: "Peer" },
        message: { name: `${CHAT_SPACE}/messages/IN${messageNumber}`, text },
      };
      const answer = await adapter.handleRequest(`Bearer ${chatIdToken()}`, JSON.stringify(event));
      if (answer.status !== 200) throw new Error(`the adapter answered ${answer.status}`);
    },
    sent: () => google.sends,
    close: async () => adapter.disconnect(),
  };
}

/**
 * An IRC server on a local port: it welcomes any nick, confirms every JOIN, records each PRIVMSG
 * body and can push a PRIVMSG from another nick.
 */
class ScriptedIrcServer {
  readonly sends: string[] = [];
  private readonly server: Server = createServer((socket) => this.accept(socket));
  private client: Socket | undefined;
  private nick = "";
  private barriers = 0;
  private readonly pongs: string[] = [];

  async listen(): Promise<number> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", () => resolve()));
    const address = this.server.address();
    if (address === null || typeof address === "string") throw new Error("not listening");
    return address.port;
  }

  /**
   * A PING the adapter must answer. Its PONG comes back on the same socket after every line the
   * adapter wrote before it, so once it arrives no earlier PRIVMSG is still in flight.
   */
  async barrier(): Promise<void> {
    this.barriers += 1;
    const token = `barrier-${this.barriers}`;
    this.client?.write(`PING :${token}\r\n`);
    await until(() => this.pongs.includes(token), `PONG ${token}`);
  }

  privmsg(text: string): void {
    this.client?.write(`:peer!p@peer.host PRIVMSG #theokit :${text}\r\n`);
  }

  async close(): Promise<void> {
    this.client?.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private accept(socket: Socket): void {
    this.client = socket;
    let buffered = "";
    socket.setEncoding("utf8");
    socket.on("error", () => undefined);
    socket.on("data", (chunk: string) => {
      buffered += chunk;
      for (let at = buffered.indexOf("\r\n"); at !== -1; at = buffered.indexOf("\r\n")) {
        this.onLine(socket, buffered.slice(0, at));
        buffered = buffered.slice(at + 2);
      }
    });
  }

  private onLine(socket: Socket, line: string): void {
    const [command = "", ...rest] = line.split(" ");
    if (command === "NICK") this.nick = rest[0] ?? "";
    if (command === "USER") socket.write(`:irc.test 001 ${this.nick} :Welcome\r\n`);
    if (command === "JOIN") socket.write(`:irc.test 366 ${this.nick} ${rest[0]} :End\r\n`);
    if (command === "PRIVMSG") this.sends.push(line.slice(line.indexOf(" :") + 2));
    if (command === "PONG") this.pongs.push(line.slice(line.indexOf(":") + 1));
  }
}

async function ircMember(): Promise<Member> {
  const server = new ScriptedIrcServer();
  const port = await server.listen();
  const adapter = new IrcAdapter({
    host: "127.0.0.1",
    port,
    tls: false,
    nick: "theobot",
    channels: ["#theokit"],
  });
  return {
    key: "irc",
    adapter,
    peerChannelId: "#theokit",
    inject: async (text) => server.privmsg(text),
    sent: () => server.sends,
    flush: () => server.barrier(),
    close: async () => {
      await adapter.disconnect();
      await server.close();
    },
  };
}

const MEMBERS: ReadonlyArray<{
  readonly key: PlatformName;
  readonly make: () => Member | Promise<Member>;
}> = [
  { key: "signal", make: signalMember },
  { key: "imessage", make: imessageMember },
  { key: "google_chat", make: googleChatMember },
  { key: "irc", make: ircMember },
];

/** Poll until `check` holds; fails naming what never happened. */
async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** A `post_outbound` hook that records the platform of every reply the runner sent. */
function countingHook(): { hook: GatewayHook; platforms: PlatformName[] } {
  const platforms: PlatformName[] = [];
  return {
    platforms,
    hook: {
      name: "count-post-outbound",
      post_outbound(ctx) {
        platforms.push(ctx.event.platform);
      },
    },
  };
}

const running: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const stop of running.splice(0)) await stop();
});

describe("GatewayRunner drives the new adapters", () => {
  it.each(MEMBERS)(
    "one inbound gives one send and one post_outbound for $key",
    async ({ key, make }) => {
      const member = await make();
      const { hook, platforms } = countingHook();
      let markHandled: () => void = () => undefined;
      const handled = new Promise<void>((resolve) => {
        markHandled = resolve;
      });
      const runner = new GatewayRunner({
        adapters: [member.adapter],
        hooks: [hook],
        handler: async (_event, ctx) => {
          await ctx.reply("hello back");
          markHandled();
        },
      });
      running.push(async () => {
        await runner.stop();
        await member.close();
      });
      await runner.start();

      await member.inject("hello");
      // `ctx.reply` returns only after its post_outbound has run, so once the handler is done a
      // second send or a second hook call would already be recorded below.
      await handled;
      await until(() => platforms.length >= 1, `post_outbound for ${key}`);
      await member.flush?.();

      expect(member.sent()).toEqual(["hello back"]);
      expect(platforms).toEqual([key]);
    },
  );

  it.each(MEMBERS)(
    "a reply written around the runner leaves post_outbound at zero ($key)",
    async ({ make }) => {
      const member = await make();
      const { hook, platforms } = countingHook();
      const runner = new GatewayRunner({
        adapters: [member.adapter],
        hooks: [hook],
        handler: async () => undefined,
      });
      running.push(async () => {
        await runner.stop();
        await member.close();
      });
      await runner.start();

      const result = await member.adapter.sendMessage({
        channel: { id: member.peerChannelId, type: "dm" },
        text: "written around the runner",
      });

      expect(result.ok).toBe(true);
      await member.flush?.();
      expect(member.sent()).toEqual(["written around the runner"]);
      expect(platforms).toEqual([]);
    },
  );
});
