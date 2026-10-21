/**
 * Cut outbound text into `PRIVMSG` bodies that fit one IRC command.
 *
 * @public
 */

/** RFC 1459's limit for one line, CRLF included. */
const LINE_LIMIT_BYTES = 512;
const CRLF_BYTES = 2;
/**
 * Bytes left for the `:nick!user@host ` prefix the server adds when it relays the line to the
 * other members; a line that fits only without it is truncated on their side.
 */
export const DEFAULT_PREFIX_RESERVE_BYTES = 100;
/** The longest UTF-8 sequence; a budget under it could not hold every code point. */
const MAX_CODE_POINT_BYTES = 4;

/**
 * Split `text` into the bodies of the `PRIVMSG <target> :…` commands that carry it.
 *
 * NUL bytes are removed and the text is split at every line break (`\r\n`, `\n` or `\r`), since
 * IRC ends a command there; empty lines are dropped. Each line is then cut so that its command,
 * with CRLF and `reserve` bytes for the relay prefix, stays within 512 bytes. A cut never falls
 * inside a code point, so each body decodes as UTF-8 on its own.
 *
 * @param text - the text to send
 * @param target - the channel or nick the commands address
 * @param reserve - bytes kept free for the relay prefix; default 100
 * @returns the bodies, in order; empty when the text holds no visible line
 * @throws RangeError when `target` is so long that no code point fits
 * @public
 */
export function splitForIrc(
  text: string,
  target: string,
  reserve = DEFAULT_PREFIX_RESERVE_BYTES,
): string[] {
  const budget = LINE_LIMIT_BYTES - CRLF_BYTES - Buffer.byteLength(`PRIVMSG ${target} :`) - reserve;
  if (budget < MAX_CODE_POINT_BYTES) {
    throw new RangeError(
      `splitForIrc: target "${target}" leaves ${budget} bytes per command, under the ${MAX_CODE_POINT_BYTES} one code point may need`,
    );
  }
  const chunks: string[] = [];
  for (const line of text.replaceAll("\0", "").split(/\r\n|\n|\r/)) {
    if (line === "") continue;
    chunks.push(...cutLine(line, budget));
  }
  return chunks;
}

/** Cut one line into pieces of at most `budget` UTF-8 bytes, at code-point boundaries. */
function cutLine(line: string, budget: number): string[] {
  const pieces: string[] = [];
  let piece = "";
  let pieceBytes = 0;
  for (const codePoint of line) {
    const bytes = Buffer.byteLength(codePoint);
    if (pieceBytes + bytes > budget) {
      pieces.push(piece);
      piece = "";
      pieceBytes = 0;
    }
    piece += codePoint;
    pieceBytes += bytes;
  }
  if (piece !== "") pieces.push(piece);
  return pieces;
}
