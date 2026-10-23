// Public API for @theokit/gateway-irc.

export { IrcAdapter } from "./adapter.js";
export { type IrcLine, ircLower, nickOf, parseIrcLine } from "./line.js";
export { privmsgToMessageEvent } from "./normalize.js";
export { DEFAULT_PREFIX_RESERVE_BYTES, splitForIrc } from "./split.js";
export type { IrcAdapterOptions, IrcEndpoint, SocketFactory } from "./types.js";
