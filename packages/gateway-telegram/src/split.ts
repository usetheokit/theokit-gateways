/**
 * Telegram's 4096-char per-message cap. Split agent responses on safe
 * boundaries before sending (T5.1, with EC-J markdown-pair preservation).
 */

const TELEGRAM_MAX_MESSAGE = 4096;
const SAFE_CHUNK = 4000;

/**
 * Split a long text into Telegram-sized chunks, preferring paragraph,
 * line, then hard boundaries. EC-J: when a chunk ends in the middle of
 * a markdown pair (`**`, `__`, `~~`, `` ` ``), trim back to the last
 * complete pair so neither chunk produces a "markdown_parse_error" 400.
 *
 * @public
 */
export function splitForTelegram(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_MESSAGE) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= SAFE_CHUNK) {
      parts.push(remaining);
      break;
    }
    let boundary = findBoundary(remaining);
    // B-556: a cut inside a table row that fits a chunk moves back to the row's start.
    const afterRow = takeRowSafe(parts, remaining, boundary);
    if (afterRow !== undefined) {
      remaining = afterRow;
      continue;
    }
    const rawChunk = remaining.slice(0, boundary);
    const balanced = balanceMarkdownPairs(rawChunk);
    // Forward progress is not negotiable. `balanceMarkdownPairs` trims back to
    // before an unbalanced marker, and when the only such marker sits at index 0
    // there is nothing to trim back TO — it returns "". Taking that as the
    // boundary made `remaining.slice(0)` return the same string on every pass:
    // an unbounded array of "" and a pegged core. The loop is synchronous, so it
    // blocks the event loop and no test timeout can interrupt it; the process
    // has to be killed. Any agent reply over the cap that opened with an
    // unclosed code span hung the bot.
    //
    // When balancing would consume the whole chunk, emit the unbalanced one
    // instead. Telegram answers that with a markdown_parse_error the caller can
    // see and map; a hung process shows nothing at all. This mirrors the core
    // chunker's `cut <= 0 ? window : cut`.
    const chunk = balanced.length > 0 ? balanced : rawChunk;
    boundary = chunk.length;
    parts.push(chunk);
    remaining = remaining.slice(boundary).replace(/^\n+/, "");
  }
  return parts;
}

/** The paragraph, then line, then hard boundary within the safe window. */
function findBoundary(remaining: string): number {
  let boundary = remaining.lastIndexOf("\n\n", SAFE_CHUNK);
  if (boundary < SAFE_CHUNK / 2) boundary = remaining.lastIndexOf("\n", SAFE_CHUNK);
  return boundary < SAFE_CHUNK / 2 ? SAFE_CHUNK : boundary;
}

/**
 * When `boundary` falls inside a table row that fits a chunk, pushes the part before the row and
 * returns the text from the row on; undefined otherwise.
 */
function takeRowSafe(parts: string[], remaining: string, boundary: number): string | undefined {
  const moved = rowSafeCut(remaining, boundary, SAFE_CHUNK);
  if (moved === undefined) return undefined;
  parts.push(remaining.slice(0, moved.end));
  return remaining.slice(moved.start);
}

/** `\n`, or `\r` alone or before `\n`: GFM reads a lone CR as a line ending too. */
const isLineEnd = (ch: string | undefined): boolean => ch === "\n" || ch === "\r";

/**
 * Where to cut instead of `cut` so a Markdown table row (a line whose first non-blank character is
 * `|`) it falls inside stays whole: `start` is the row's first character, `end` where the chunk
 * ends with its trailing line endings dropped. Undefined when `cut` is not inside a row, the row
 * opens the chunk, or the row is longer than `window`. The same rule is in core `chunkText`
 * (`keepTableRows`); this package keeps its own copy because it peers core `>=0.9.0`.
 */
function rowSafeCut(
  text: string,
  cut: number,
  window: number,
): { readonly end: number; readonly start: number } | undefined {
  const start = tableRowStart(text, cut);
  if (start === undefined || rowLength(text, start, cut, window) > window) return undefined;
  let end = start;
  while (end > 0 && isLineEnd(text[end - 1])) end -= 1;
  return end > 0 ? { end, start } : undefined;
}

/** Start of the table row `cut` falls inside, or undefined (not in a row, or the row opens the text). */
function tableRowStart(text: string, cut: number): number | undefined {
  if (cut >= text.length || isLineEnd(text[cut])) return undefined;
  let start = cut;
  while (start > 0 && !isLineEnd(text[start - 1])) start -= 1;
  return start > 0 && /^[^\S\r\n]*\|/.test(text.slice(start, cut + 1)) ? start : undefined;
}

/** Length of the row from `start`, scanning no further than `window` past it. */
function rowLength(text: string, start: number, cut: number, window: number): number {
  let rowEnd = cut;
  while (rowEnd < text.length && rowEnd - start <= window && !isLineEnd(text[rowEnd])) rowEnd += 1;
  return rowEnd - start;
}

/**
 * EC-J: trim back to before an unbalanced markdown marker so the
 * chunk passes Telegram MarkdownV1 parsing.
 */
function balanceMarkdownPairs(chunk: string): string {
  const markers = ["**", "__", "~~", "`"];
  let out = chunk;
  for (const m of markers) {
    const count = countOccurrences(out, m);
    if (count % 2 === 1) {
      const lastIdx = out.lastIndexOf(m);
      out = out.slice(0, lastIdx).trimEnd();
    }
  }
  return out;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while (true) {
    const found = haystack.indexOf(needle, pos);
    if (found === -1) break;
    count += 1;
    pos = found + needle.length;
  }
  return count;
}
