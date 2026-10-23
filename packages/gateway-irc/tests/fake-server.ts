/**
 * An IRC server in this process, on a `node:net` port the system picks. It scripts just enough of
 * registration, SASL PLAIN and JOIN for the adapter's tests, records every line a client sends,
 * and can push lines to the connected client. Nothing leaves the machine.
 */

import { createServer, type Server, type Socket } from "node:net";

import type { IrcAdapterOptions } from "../src/index.js";
import { IrcAdapter } from "../src/index.js";

export interface FakeServerScript {
  /** Nicks the server answers 433 for. */
  readonly nicksInUse?: readonly string[];
  /** How the server answers the SASL credentials. Default `"ok"`. */
  readonly sasl?: "ok" | "fail";
  /** Answer nothing at all, so `connect()` can only time out. */
  readonly silent?: boolean;
  /** Close the connection as soon as the client opens it. */
  readonly closeOnConnect?: boolean;
  /** Answer `PASS` with 464 (password mismatch). */
  readonly rejectPassword?: boolean;
  /** The `CAP LS` reply, one line per entry. Default: one line offering `sasl`. */
  readonly capLs?: readonly string[];
  /** Answer `CAP` with 421 (unknown command), as a server without IRCv3 does. */
  readonly noCap?: boolean;
}

export const SERVER_NAME = "fake.irc.test";

export class FakeIrcServer {
  /** Every line any client sent, without CRLF, in arrival order. */
  readonly received: string[] = [];
  connections = 0;
  private readonly server: Server;
  private client: Socket | undefined;
  private nick: string | undefined;
  private userSeen = false;
  private capNegotiating = false;
  private capEnded = false;
  private welcomed = false;

  private constructor(private readonly script: FakeServerScript) {
    this.server = createServer((socket) => this.accept(socket));
  }

  static async start(script: FakeServerScript = {}): Promise<FakeIrcServer> {
    const fake = new FakeIrcServer(script);
    await new Promise<void>((resolve) => fake.server.listen(0, "127.0.0.1", () => resolve()));
    return fake;
  }

  get port(): number {
    const address = this.server.address();
    if (address === null || typeof address === "string") throw new Error("not listening");
    return address.port;
  }

  /** An adapter pointed at this server over plain TCP, joining `#theokit` unless told otherwise. */
  adapter(overrides: Partial<IrcAdapterOptions> = {}): IrcAdapter {
    return new IrcAdapter({
      host: "127.0.0.1",
      port: this.port,
      tls: false,
      nick: "theobot",
      channels: ["#theokit"],
      ...overrides,
    });
  }

  /** Push one raw line to the connected client. */
  push(line: string): void {
    this.client?.write(`${line}\r\n`);
  }

  /** Lines received whose command (after any tags or prefix) is `command`. */
  linesOf(command: string): string[] {
    return this.received.filter((line) => line.split(" ")[0] === command);
  }

  async close(): Promise<void> {
    this.client?.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private accept(socket: Socket): void {
    this.connections += 1;
    this.client = socket;
    if (this.script.closeOnConnect) {
      socket.destroy();
      return;
    }
    let buffered = "";
    socket.setEncoding("utf8");
    socket.on("error", () => undefined);
    socket.on("data", (chunk: string) => {
      buffered += chunk;
      for (let at = buffered.indexOf("\r\n"); at !== -1; at = buffered.indexOf("\r\n")) {
        const line = buffered.slice(0, at);
        buffered = buffered.slice(at + 2);
        this.received.push(line);
        if (!this.script.silent) this.answer(line);
      }
    });
  }

  private answer(line: string): void {
    const [command = "", ...rest] = line.split(" ");
    const argument = rest.join(" ");
    switch (command) {
      case "PASS":
        if (this.script.rejectPassword) this.push(`:${SERVER_NAME} 464 * :Password incorrect`);
        return;
      case "CAP":
        this.onCap(argument);
        return;
      case "AUTHENTICATE":
        this.onAuthenticate(argument);
        return;
      case "NICK":
        this.onNick(argument);
        return;
      case "USER":
        this.userSeen = true;
        this.welcomeWhenReady();
        return;
      case "JOIN":
        for (const channel of argument.split(",")) {
          this.push(`:${this.nick}!u@fake.host JOIN ${channel}`);
          this.push(`:${SERVER_NAME} 366 ${this.nick} ${channel} :End of /NAMES list.`);
        }
        return;
      case "QUIT":
        this.client?.end();
        return;
      default:
        return;
    }
  }

  private onCap(argument: string): void {
    if (this.script.noCap) {
      this.push(`:${SERVER_NAME} 421 * CAP :Unknown command`);
      return;
    }
    if (argument.startsWith("LS")) {
      this.capNegotiating = true;
      for (const reply of this.script.capLs ?? ["* LS :multi-prefix sasl=PLAIN,EXTERNAL"]) {
        this.push(`:${SERVER_NAME} CAP ${reply}`);
      }
    } else if (argument === "REQ :sasl") {
      this.push(`:${SERVER_NAME} CAP * ACK :sasl`);
    } else if (argument === "END") {
      this.capEnded = true;
      this.welcomeWhenReady();
    }
  }

  private onAuthenticate(argument: string): void {
    if (argument === "PLAIN") {
      this.push("AUTHENTICATE +");
      return;
    }
    if (this.script.sasl === "fail") {
      this.push(`:${SERVER_NAME} 904 * :SASL authentication failed`);
      return;
    }
    this.push(`:${SERVER_NAME} 900 * * theobot :You are now logged in as theobot`);
    this.push(`:${SERVER_NAME} 903 * :SASL authentication successful`);
  }

  private onNick(nick: string): void {
    if (this.script.nicksInUse?.includes(nick)) {
      this.push(`:${SERVER_NAME} 433 * ${nick} :Nickname is already in use`);
      return;
    }
    this.nick = nick;
    this.welcomeWhenReady();
  }

  /** 001 and 002 once NICK and USER arrived and, when CAP negotiation began, after CAP END. */
  private welcomeWhenReady(): void {
    if (this.welcomed || this.nick === undefined || !this.userSeen) return;
    if (this.capNegotiating && !this.capEnded) return;
    this.welcomed = true;
    this.push(`:${SERVER_NAME} 001 ${this.nick} :Welcome to the fake network ${this.nick}`);
    this.push(`:${SERVER_NAME} 002 ${this.nick} :Your host is ${SERVER_NAME}`);
  }
}

/** Poll until `check` holds; fails naming what never happened. */
export async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
