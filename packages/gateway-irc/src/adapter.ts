/**
 * `IrcAdapter` — `BasePlatformAdapter` over one IRC connection, speaking the line protocol itself
 * over `node:tls` (or `node:net`).
 *
 * @public
 */

import { isIP, connect as netConnect } from "node:net";
import type { Duplex } from "node:stream";
import { connect as tlsConnect } from "node:tls";

import {
  BasePlatformAdapter,
  channelRendering,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
} from "@theokit/gateway";

import { type IrcLine, ircLower, nickOf, parseIrcLine } from "./line.js";
import { privmsgToMessageEvent } from "./normalize.js";
import { Registration, type RegistrationOptions } from "./registration.js";
import { splitForIrc } from "./split.js";
import type { IrcAdapterOptions, SocketFactory } from "./types.js";

const DEFAULT_PORT = 6697;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const LABEL = "gateway-irc";
/** A target is one token with no line break; anything else could carry a second command. */
const TARGET = /^[^\s,:][^\s,]*$/;
const CHANNEL = /^[#&][^\s,]+$/;
const NICK = /^[^\s:#&!@,][^\s!@,]*$/;
/** NUL ends a C string on many servers and BEL (Ctrl-G) is forbidden in a channel name. */
const hasControlByte = (text: string): boolean => text.includes("\0") || text.includes("\u0007");

const defaultSocketFactory: SocketFactory = ({ host, port, tls }) =>
  tls
    ? tlsConnect({ host, port, ...(isIP(host) === 0 ? { servername: host } : {}) })
    : netConnect({ host, port });

/**
 * IRC adapter for one nick on one network.
 *
 * `connect()` registers the nick (with SASL PLAIN when `saslPassword` is set), joins every channel
 * and answers `true` once each join is confirmed; it answers `false`, never a throw, when the
 * server refuses, the socket closes or `connectTimeoutMs` passes first. Every `PRIVMSG` from
 * another nick becomes an `IrcMessageEvent`.
 *
 * @public
 */
export class IrcAdapter extends BasePlatformAdapter {
  readonly platform = "irc" as const;
  private readonly opts: IrcAdapterOptions;
  private socket: Duplex | undefined;
  private nick: string;
  private handler: ((event: GatewayMessageEvent) => Promise<void>) | undefined;
  private connected = false;
  private connecting: Promise<boolean> | undefined;
  private warnedAboutHtml = false;
  private received = 0;

  /**
   * @throws Error when `host`, `nick`, a channel name or a credential field is malformed; each is
   *   a programmer error the server would only report after a connection, and a line break in any
   *   of them would let it carry a second command.
   */
  constructor(opts: IrcAdapterOptions) {
    super();
    validateOptions(opts);
    this.opts = opts;
    this.nick = opts.nick;
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    // A second caller while the first is registering shares its answer instead of opening a
    // second connection, which would hold the nick and deliver every message twice.
    this.connecting ??= this.openSession().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  async disconnect(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    this.connected = false;
    if (socket === undefined || socket.destroyed) return;
    socket.end("QUIT :disconnecting\r\n");
    // A server that never closes its side would hold the socket open; give it a second.
    setTimeout(() => socket.destroy(), 1_000).unref();
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "outbound text is empty" } };
    }
    const target = out.channel.id;
    if (!TARGET.test(target) || hasControlByte(target)) {
      return {
        ok: false,
        error: {
          code: "invalid_target",
          message: `channel.id must be one channel or nick with no spaces or line breaks, got ${JSON.stringify(target)}`,
        },
      };
    }
    const socket = this.socket;
    if (!this.connected || socket === undefined || socket.destroyed) {
      return {
        ok: false,
        error: { code: "not_connected", message: "IrcAdapter.connect() has not succeeded" },
      };
    }
    let chunks: string[];
    try {
      chunks = splitForIrc(this.textFor(out), target);
    } catch (err) {
      if (!(err instanceof RangeError)) throw err;
      return { ok: false, error: { code: "invalid_target", message: err.message } };
    }
    if (chunks.length === 0) {
      return {
        ok: false,
        error: { code: "empty_text", message: "outbound text has no visible line" },
      };
    }
    // One synchronous write per message: two sends started together reach the server in call
    // order, and never interleave their lines.
    socket.write(chunks.map((chunk) => `PRIVMSG ${target} :${chunk}\r\n`).join(""));
    return { ok: true };
  }

  onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    // Replace, not stack.
    this.handler = handler;
    return () => {
      if (this.handler === handler) {
        this.handler = undefined;
      }
    };
  }

  /**
   * Deliver an event that arrived out of band. One line over `runHandler`, which owns the
   * containment of a throwing handler.
   */
  override async deliver(
    event: GatewayMessageEvent,
  ): Promise<"ok" | "no_handler" | "handler_threw"> {
    return this.runHandler(this.handler, event);
  }

  /** The text to send: markdown loses its markers, html goes as is with one warning. */
  private textFor(out: OutboundMessage): string {
    if (out.format === "markdown") return channelRendering(this.platform).translate(out.text);
    if (out.format === "html" && !this.warnedAboutHtml) {
      this.warnedAboutHtml = true;
      process.stderr.write(
        `[${LABEL}] format="html" was declared and IRC has no html mode; sending the text unchanged. Logged once.\n`,
      );
    }
    return out.text;
  }

  /** Open the socket and run the handshake; the socket is kept only when it succeeds. */
  private openSession(): Promise<boolean> {
    const socket = this.openSocket();
    if (socket === undefined) return Promise.resolve(false);
    this.socket = socket;
    const registration = new Registration(this.registrationOptions(), (line) =>
      writeLine(socket, line),
    );
    const timeoutMs = this.opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    return new Promise<boolean>((resolve) => {
      const attempt = new ConnectAttempt(timeoutMs, (ok, reason) => {
        resolve(this.finishConnect(socket, registration, ok, reason));
      });
      readLines(socket, (raw) => this.onRaw(socket, registration, attempt, raw));
      socket.on("error", (err: Error) => {
        if (attempt.settled) process.stderr.write(`[${LABEL}] socket error: ${err.message}\n`);
        else attempt.settle(false, `socket error: ${err.message}`);
      });
      socket.on("close", () => this.onClose(socket, attempt));
      registration.start();
    });
  }

  /** The socket from the factory, or `undefined` (logged) when the factory throws. */
  private openSocket(): Duplex | undefined {
    try {
      return (this.opts.socketFactory ?? defaultSocketFactory)({
        host: this.opts.host,
        port: this.opts.port ?? DEFAULT_PORT,
        tls: this.opts.tls ?? true,
      });
    } catch (err) {
      process.stderr.write(
        `[${LABEL}] connect failed: could not open the socket: ${message(err)}\n`,
      );
      return undefined;
    }
  }

  private registrationOptions(): RegistrationOptions {
    const { nick, username, realname, password, saslAccount, saslPassword, channels } = this.opts;
    return {
      nick,
      username: username ?? nick,
      realname: realname ?? nick,
      channels,
      ...(password === undefined ? {} : { password }),
      ...(saslAccount === undefined ? {} : { saslAccount }),
      ...(saslPassword === undefined ? {} : { saslPassword }),
    };
  }

  /**
   * Keep the socket on success and answer `true`; otherwise log the reason, end the socket and
   * answer `false`. A handshake that succeeds after `disconnect()` gave the socket up is a failure:
   * the caller no longer wants the connection.
   */
  private finishConnect(
    socket: Duplex,
    registration: Registration,
    ok: boolean,
    reason: string | undefined,
  ): boolean {
    if (ok && this.socket === socket) {
      this.nick = registration.nick;
      this.connected = true;
      return true;
    }
    const why = ok ? "disconnect() was called before registration finished" : reason;
    process.stderr.write(`[${LABEL}] connect failed: ${why ?? "unknown"}\n`);
    if (this.socket === socket) this.socket = undefined;
    socket.destroy();
    return false;
  }

  /** One line from the server: PING at any time, the handshake until it settles, then messages. */
  private onRaw(
    socket: Duplex,
    registration: Registration,
    attempt: ConnectAttempt,
    raw: string,
  ): void {
    const line = parseIrcLine(raw);
    if (line === undefined) return;
    if (line.command === "PING") {
      writeLine(socket, `PONG :${line.params[0] ?? ""}`);
      return;
    }
    if (attempt.settled) {
      this.onLine(line, raw);
      return;
    }
    const outcome = registration.onLine(line);
    if (outcome !== undefined) attempt.settle(outcome.ok, outcome.ok ? undefined : outcome.reason);
  }

  private onClose(socket: Duplex, attempt: ConnectAttempt): void {
    if (!attempt.settled) {
      attempt.settle(false, "the server closed the connection");
      return;
    }
    if (this.socket !== socket) return;
    process.stderr.write(`[${LABEL}] the connection closed\n`);
    this.socket = undefined;
    this.connected = false;
  }

  /** A line after registration: follow our own nick changes, and deliver messages. */
  private onLine(line: IrcLine, raw: string): void {
    if (line.command === "NICK" && ircLower(nickOf(line.prefix)) === ircLower(this.nick)) {
      this.nick = line.params[0] ?? this.nick;
      return;
    }
    if (line.command !== "PRIVMSG") return;
    this.received += 1;
    const event = privmsgToMessageEvent(line, raw, this.nick, Date.now(), this.received);
    if (event === undefined) return;
    void this.runHandler(this.handler, event).catch((err: unknown) => {
      process.stderr.write(`[${LABEL}] handler threw: ${message(err)}\n`);
    });
  }
}

/** Throw on any option the server would refuse, or that could carry a second command. */
function validateOptions(opts: IrcAdapterOptions): void {
  if (opts.host.trim() === "") throw new Error(`${LABEL}: opts.host is empty`);
  if (!NICK.test(opts.nick) || hasControlByte(opts.nick)) {
    throw new Error(`${LABEL}: opts.nick "${opts.nick}" is not a valid IRC nick`);
  }
  const badChannel = opts.channels.find(
    (channel) => !CHANNEL.test(channel) || hasControlByte(channel),
  );
  if (badChannel !== undefined) {
    throw new Error(`${LABEL}: channel "${badChannel}" must be #name or &name with no spaces`);
  }
  const lineFields = ["password", "saslAccount", "saslPassword", "realname", "username"] as const;
  const broken = lineFields.find((field) => /[\r\n\0]/.test(opts[field] ?? ""));
  if (broken !== undefined) throw new Error(`${LABEL}: opts.${broken} holds a line break or NUL`);
  if (/\s/.test(opts.username ?? "")) {
    throw new Error(`${LABEL}: opts.username holds a space; USER takes it as one word`);
  }
}

/** One connect attempt: settles once, by the handshake, the socket or the deadline. */
class ConnectAttempt {
  settled = false;
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(
    timeoutMs: number,
    private readonly onSettled: (ok: boolean, reason: string | undefined) => void,
  ) {
    this.timer = setTimeout(
      () => this.settle(false, `no registration within ${timeoutMs} ms`),
      timeoutMs,
    );
  }

  settle(ok: boolean, reason?: string): void {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer);
    this.onSettled(ok, reason);
  }
}

function writeLine(socket: Duplex, line: string): void {
  socket.write(`${line}\r\n`);
}

/** Call `onLine` for each line the socket delivers, split at CRLF or a bare LF. */
function readLines(socket: Duplex, onLine: (raw: string) => void): void {
  let buffered = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffered += chunk;
    let at = buffered.indexOf("\n");
    while (at !== -1) {
      const raw = buffered.slice(0, at).replace(/\r$/, "");
      buffered = buffered.slice(at + 1);
      if (raw !== "") onLine(raw);
      at = buffered.indexOf("\n");
    }
  });
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
