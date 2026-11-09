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
    const [piece, reopen] = closeFence(chunk);
    parts.push(piece);
    remaining = reopen + remaining.slice(boundary).replace(/^\n+/, "");
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
  const [piece, reopen] = closeFence(remaining.slice(0, moved.end));
  parts.push(piece);
  return reopen + remaining.slice(moved.start);
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

/** A fenced code line: 3+ backticks or tildes, up to 3 spaces of indent, then the info string. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

interface Fence {
  readonly marker: string;
  readonly info: string;
}

/** Longest info string a reopened fence repeats, so the reopening cannot eat the chunk's headroom. */
const MAX_INFO = 40;

/** The `[start, end)` ranges of `text` that lie inside fenced code, fence lines included. */
function fencedRanges(text: string): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  let open: OpenFence | undefined;
  let pos = 0;
  for (const line of text.split("\n")) {
    open = stepFence(open, line, pos, ranges);
    pos += line.length + 1;
  }
  if (open !== undefined) ranges.push([open.start, text.length]);
  return ranges;
}

interface OpenFence {
  readonly fence: Fence;
  readonly start: number;
}

/** Folds one line into the fence state; a fence that closes on it is added to `ranges`. */
function stepFence(
  open: OpenFence | undefined,
  line: string,
  pos: number,
  ranges: Array<readonly [number, number]>,
): OpenFence | undefined {
  const m = FENCE_LINE.exec(line.replace(/\r$/, ""));
  const marker = m?.[1];
  if (marker === undefined) return open;
  if (open === undefined) return { fence: { marker, info: (m?.[2] ?? "").trim() }, start: pos };
  if (!closesFence(open.fence, marker, m?.[2] ?? "")) return open;
  ranges.push([open.start, pos + line.length]);
  return undefined;
}

function closesFence(fence: Fence, marker: string, rest: string): boolean {
  return (
    marker[0] === fence.marker[0] && marker.length >= fence.marker.length && rest.trim() === ""
  );
}

/** The fence still open at the end of `text`, if any. */
function openFenceAt(text: string): Fence | undefined {
  const last = fencedRanges(text).at(-1);
  if (last === undefined || last[1] !== text.length) return undefined;
  const lines = text.slice(last[0]).split("\n");
  const opener = FENCE_LINE.exec(lines[0] ?? "");
  const closer = lines.length > 1 ? FENCE_LINE.exec((lines.at(-1) ?? "").replace(/\r$/, "")) : null;
  if (opener?.[1] === undefined) return undefined;
  const fence = { marker: opener[1], info: (opener[2] ?? "").trim().slice(0, MAX_INFO) };
  if (closer?.[1] !== undefined && closesFence(fence, closer[1], closer[2] ?? "")) return undefined;
  return fence;
}

/**
 * B-526: a cut inside a fenced code block closes the fence at the end of the chunk and reopens it
 * at the start of the next. Returns the chunk and the text to put before the rest.
 */
function closeFence(chunk: string): [string, string] {
  const open = openFenceAt(chunk);
  if (open === undefined) return [chunk, ""];
  return [`${chunk}\n${open.marker}`, `${open.marker}${open.info}\n`];
}

/**
 * EC-J: trim back to before an unbalanced markdown marker so the
 * chunk passes Telegram MarkdownV1 parsing. Markers inside fenced code are not counted:
 * the fence is the chunk's business, not the markers within it.
 */
function balanceMarkdownPairs(chunk: string): string {
  const markers = ["**", "__", "~~", "`"];
  let out = chunk;
  for (const m of markers) {
    const outside = markerIndexes(out, m);
    if (outside.length % 2 === 1) {
      out = out.slice(0, outside[outside.length - 1]).trimEnd();
    }
  }
  return out;
}

/** Indexes of `needle` in `text`, non-overlapping, skipping those inside fenced code. */
function markerIndexes(text: string, needle: string): number[] {
  const ranges = fencedRanges(text);
  const found: number[] = [];
  let pos = 0;
  while (true) {
    const at = text.indexOf(needle, pos);
    if (at === -1) break;
    pos = at + needle.length;
    if (!ranges.some(([a, b]) => at >= a && at < b)) found.push(at);
  }
  return found;
}
