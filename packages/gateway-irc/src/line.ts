/**
 * One IRC line, read per RFC 1459 with IRCv3 message tags.
 *
 * @public
 */

/**
 * A parsed IRC line. `params` holds the middle parameters and, last, the trailing one, which keeps
 * every colon and space it carried.
 *
 * @public
 */
export interface IrcLine {
  /** IRCv3 message tags, unescaped; `{}` when the line carried none. */
  readonly tags: Readonly<Record<string, string>>;
  /** The source, `nick!user@host` or a server name, when the line carried one. */
  readonly prefix?: string;
  /** The command in upper case, or a three-digit numeric. */
  readonly command: string;
  readonly params: readonly string[];
}

const TAG_ESCAPES: Readonly<Record<string, string>> = {
  ":": ";",
  s: " ",
  "\\": "\\",
  r: "\r",
  n: "\n",
};

/**
 * Parse one line, without its CRLF. Returns `undefined` for a line with no command.
 *
 * @public
 */
export function parseIrcLine(raw: string): IrcLine | undefined {
  let rest = raw;
  let tags: Record<string, string> = {};
  if (rest.startsWith("@")) {
    const end = rest.indexOf(" ");
    if (end === -1) return undefined;
    tags = parseTags(rest.slice(1, end));
    rest = rest.slice(end + 1).trimStart();
  }
  let prefix: string | undefined;
  if (rest.startsWith(":")) {
    const end = rest.indexOf(" ");
    if (end === -1) return undefined;
    prefix = rest.slice(1, end);
    rest = rest.slice(end + 1).trimStart();
  }
  const [command, params] = splitCommand(rest);
  if (command === "") return undefined;
  return prefix === undefined ? { tags, command, params } : { tags, prefix, command, params };
}

/**
 * The nick in a `nick!user@host` prefix, or the whole prefix when it has no `!`.
 *
 * @public
 */
export function nickOf(prefix: string | undefined): string {
  if (prefix === undefined) return "";
  const bang = prefix.indexOf("!");
  return bang === -1 ? prefix : prefix.slice(0, bang);
}

/**
 * Lower-case a nick or channel name under the `rfc1459` case mapping, the default when a server
 * announces none: `[]\~` are the upper-case forms of `{}|^`.
 *
 * @public
 */
export function ircLower(name: string): string {
  return name
    .toLowerCase()
    .replaceAll("[", "{")
    .replaceAll("]", "}")
    .replaceAll("\\", "|")
    .replaceAll("~", "^");
}

/** The command and its parameters, the trailing one (after ` :`) kept whole. */
function splitCommand(text: string): [string, string[]] {
  const params: string[] = [];
  let rest = text;
  const commandEnd = rest.indexOf(" ");
  const command = (commandEnd === -1 ? rest : rest.slice(0, commandEnd)).toUpperCase();
  rest = commandEnd === -1 ? "" : rest.slice(commandEnd + 1);
  while (rest !== "") {
    if (rest.startsWith(":")) {
      params.push(rest.slice(1));
      break;
    }
    const end = rest.indexOf(" ");
    if (end === -1) {
      params.push(rest);
      break;
    }
    if (end > 0) params.push(rest.slice(0, end));
    rest = rest.slice(end + 1);
  }
  return [command, params];
}

function parseTags(text: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const pair of text.split(";")) {
    if (pair === "") continue;
    const equals = pair.indexOf("=");
    const key = equals === -1 ? pair : pair.slice(0, equals);
    tags[key] = equals === -1 ? "" : unescapeTag(pair.slice(equals + 1));
  }
  return tags;
}

function unescapeTag(value: string): string {
  return value.replace(/\\(.?)/g, (_match, next: string) => TAG_ESCAPES[next] ?? next);
}
