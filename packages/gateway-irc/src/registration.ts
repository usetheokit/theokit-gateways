/**
 * The connect handshake as a state machine: PASS, optional SASL PLAIN, NICK and USER, the 433
 * retry, then JOIN and the 366 for each channel.
 *
 * It writes lines through the function it is given and reads the lines the adapter hands it, so it
 * owns no socket and no timer; the adapter owns both.
 */

import { type IrcLine, ircLower } from "./line.js";

/** How many times a nick in use (433) is retried with `_` appended. */
export const NICK_RETRIES = 3;
/** SASL sends the credentials in base64 chunks of this many bytes. */
const AUTHENTICATE_CHUNK = 400;

/** The fields of `IrcAdapterOptions` the handshake reads. */
export interface RegistrationOptions {
  readonly nick: string;
  readonly username: string;
  readonly realname: string;
  readonly password?: string;
  readonly saslAccount?: string;
  readonly saslPassword?: string;
  readonly channels: readonly string[];
}

/** How the handshake ended: registered and joined, or refused with a reason. */
export type RegistrationOutcome =
  | { readonly ok: true; readonly nick: string }
  | { readonly ok: false; readonly reason: string };

/** Numerics that refuse a JOIN, each ending the handshake. */
const JOIN_REFUSALS = new Set(["403", "405", "471", "473", "474", "475", "477"]);
/** Numerics that refuse SASL. */
const SASL_REFUSALS = new Set(["902", "904", "905", "906", "908"]);

export class Registration {
  /** The nick being registered, then the one the server welcomed. */
  nick: string;
  private retries = 0;
  private welcomed = false;
  private saslDone = false;
  /** Capabilities offered so far by a `CAP LS` that may span several lines. */
  private offered: string[] = [];
  private readonly waitingFor: Set<string>;

  constructor(
    private readonly opts: RegistrationOptions,
    private readonly write: (line: string) => void,
  ) {
    this.nick = opts.nick;
    this.waitingFor = new Set(opts.channels.map(ircLower));
  }

  /** The opening lines. With SASL, `CAP LS 302` goes first so the server holds registration. */
  start(): void {
    if (this.opts.password !== undefined) this.write(`PASS :${this.opts.password}`);
    if (this.opts.saslPassword !== undefined) this.write("CAP LS 302");
    this.write(`NICK ${this.nick}`);
    this.write(`USER ${this.opts.username} 0 * :${this.opts.realname}`);
  }

  /** Read one line; returns the outcome once the handshake is over, else `undefined`. */
  onLine(line: IrcLine): RegistrationOutcome | undefined {
    if (line.command === "ERROR")
      return refused(`the server closed the link: ${line.params[0] ?? ""}`);
    if (line.command === "CAP") return this.onCap(line);
    if (line.command === "AUTHENTICATE") return this.onAuthenticate(line);
    if (SASL_REFUSALS.has(line.command))
      return refused(`SASL refused (${line.command}): ${last(line)}`);
    if (JOIN_REFUSALS.has(line.command)) {
      return refused(`could not join ${line.params[1] ?? "?"} (${line.command}): ${last(line)}`);
    }
    switch (line.command) {
      case "903":
        this.saslDone = true;
        this.write("CAP END");
        return undefined;
      case "464":
      case "465":
        return refused(`the server refused the connection (${line.command}): ${last(line)}`);
      case "433":
        return this.onNickInUse();
      case "001":
        return this.onWelcome(line);
      case "366":
        this.waitingFor.delete(ircLower(line.params[1] ?? ""));
        return this.joinedAll();
      default:
        return undefined;
    }
  }

  private onCap(line: IrcLine): RegistrationOutcome | undefined {
    const [, subcommand, ...rest] = line.params;
    const list = rest.at(-1) ?? "";
    if (subcommand === "LS") {
      this.offered.push(...list.split(" ").map((cap) => cap.split("=")[0] ?? ""));
      // A multi-line LS marks every line but the last with `*` before the list; decide on the last.
      if (rest.length > 1) return undefined;
      if (!this.offered.includes("sasl")) return refused("the server offers no SASL");
      this.write("CAP REQ :sasl");
    } else if (subcommand === "ACK" && list.split(" ").includes("sasl")) {
      this.write("AUTHENTICATE PLAIN");
    } else if (subcommand === "NAK") {
      return refused("the server refused the sasl capability");
    }
    return undefined;
  }

  private onAuthenticate(line: IrcLine): RegistrationOutcome | undefined {
    if (line.params[0] !== "+") return undefined;
    const account = this.opts.saslAccount ?? this.opts.nick;
    const encoded = Buffer.from(`${account}\0${account}\0${this.opts.saslPassword ?? ""}`).toString(
      "base64",
    );
    for (let at = 0; at < encoded.length; at += AUTHENTICATE_CHUNK) {
      this.write(`AUTHENTICATE ${encoded.slice(at, at + AUTHENTICATE_CHUNK)}`);
    }
    // A payload that ends on a chunk boundary is closed by an empty chunk.
    if (encoded.length % AUTHENTICATE_CHUNK === 0) this.write("AUTHENTICATE +");
    return undefined;
  }

  private onNickInUse(): RegistrationOutcome | undefined {
    if (this.welcomed) return undefined;
    if (this.retries >= NICK_RETRIES) {
      return refused(`nick ${this.nick} is in use after ${NICK_RETRIES} retries`);
    }
    this.retries += 1;
    this.nick = `${this.nick}_`;
    this.write(`NICK ${this.nick}`);
    return undefined;
  }

  private onWelcome(line: IrcLine): RegistrationOutcome | undefined {
    if (this.opts.saslPassword !== undefined && !this.saslDone) {
      return refused("the server welcomed the nick without SASL, so the account is not logged in");
    }
    this.welcomed = true;
    this.nick = line.params[0] ?? this.nick;
    if (this.opts.channels.length === 0) return { ok: true, nick: this.nick };
    this.write(`JOIN ${this.opts.channels.join(",")}`);
    return undefined;
  }

  private joinedAll(): RegistrationOutcome | undefined {
    if (!this.welcomed || this.waitingFor.size > 0) return undefined;
    return { ok: true, nick: this.nick };
  }
}

function refused(reason: string): RegistrationOutcome {
  return { ok: false, reason };
}

function last(line: IrcLine): string {
  return line.params.at(-1) ?? "";
}
