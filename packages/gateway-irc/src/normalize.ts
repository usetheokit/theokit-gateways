/**
 * A `PRIVMSG` line to an `IrcMessageEvent`.
 *
 * @public
 */

import type { IrcMessageEvent } from "@theokit/gateway";

import { type IrcLine, ircLower, nickOf } from "./line.js";

const CTCP = "\u0001";
const ACTION = "ACTION ";

/**
 * Build the event for one `PRIVMSG`, or `undefined` when nobody should see it: a line that is not
 * a `PRIVMSG`, one the adapter's own nick sent, a CTCP request other than `ACTION` (`VERSION`,
 * `PING`, `TIME`…), or a message with no text.
 *
 * A target starting with `#` or `&` is a channel and becomes a `group` channel; anything else was
 * addressed to the adapter's nick and becomes a `dm` whose id is the sender, the address a reply
 * goes to. The event id is the IRCv3 `msgid` tag when the server sent one, else
 * `<nick>:<receivedAt>:<counter>`.
 *
 * @param line - the parsed line
 * @param raw - the line as received, without CRLF
 * @param ownNick - the nick the adapter holds now
 * @param receivedAt - when the line was read, in ms since the epoch
 * @param counter - a per-adapter sequence number, for the fallback id
 * @public
 */
export function privmsgToMessageEvent(
  line: IrcLine,
  raw: string,
  ownNick: string,
  receivedAt: number,
  counter: number,
): IrcMessageEvent | undefined {
  if (line.command !== "PRIVMSG") return undefined;
  const [target, body] = line.params;
  const nick = nickOf(line.prefix);
  if (target === undefined || body === undefined || nick === "") return undefined;
  if (ircLower(nick) === ircLower(ownNick)) return undefined;
  const content = ctcpContent(body);
  if (content === undefined || content.text === "") return undefined;
  const isChannel = target.startsWith("#") || target.startsWith("&");
  return {
    id: line.tags.msgid ?? `${nick}:${receivedAt}:${counter}`,
    platform: "irc",
    sender: { id: nick, displayName: nick },
    channel: isChannel ? { id: target, type: "group" } : { id: nick, type: "dm" },
    text: content.text,
    receivedAt,
    irc: { target, nick, action: content.action, tags: line.tags, raw },
  };
}

/** The visible text of a body: an `ACTION` without its framing, `undefined` for other CTCP. */
function ctcpContent(body: string): { text: string; action: boolean } | undefined {
  if (!body.startsWith(CTCP)) return { text: body, action: false };
  const inner = body.endsWith(CTCP) && body.length > 1 ? body.slice(1, -1) : body.slice(1);
  if (!inner.startsWith(ACTION)) return undefined;
  return { text: inner.slice(ACTION.length), action: true };
}
