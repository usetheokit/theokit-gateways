/**
 * Markdown markers → Signal text styles.
 *
 * Signal has no markdown mode. Its `send` takes the bare text plus `textStyle` ranges,
 * `start:length:STYLE`, counted in UTF-16 code units, which is what `String.prototype.length`
 * counts. A marker sent as text arrives as literal asterisks.
 *
 * @public
 */

/** The text to send and the style ranges that go with it. */
export interface StyledText {
  /** The text with every recognised marker removed. */
  readonly message: string;
  /** One `start:length:STYLE` entry per styled run, in the order the runs open. */
  readonly textStyle: readonly string[];
}

type Style = "BOLD" | "ITALIC" | "STRIKETHROUGH" | "MONOSPACE";

/** Longest marker first, so `**` is never read as two italic markers. */
const MARKERS: ReadonlyArray<readonly [string, Style]> = [
  ["**", "BOLD"],
  ["~~", "STRIKETHROUGH"],
  ["`", "MONOSPACE"],
  ["*", "ITALIC"],
  ["_", "ITALIC"],
];

const WORD = /[\p{L}\p{N}]/u;

/**
 * Remove the markers of `**bold**`, `*italic*` or `_italic_`, `~~strike~~` and `` `code` `` and
 * return their ranges. A marker with no closing partner, or one wrapping only whitespace, stays
 * in the text; so does an underscore inside a word (`snake_case`). Code spans are literal: no
 * marker inside one is read.
 *
 * @param text - markdown as an agent wrote it
 * @returns the text to send and its `textStyle` entries
 */
export function toTextStyle(text: string): StyledText {
  let message = "";
  const textStyle: string[] = [];
  let i = 0;
  while (i < text.length) {
    const run = runAt(text, i);
    if (run === undefined) {
      message += text[i];
      i += 1;
      continue;
    }
    const start = message.length;
    if (run.style === "MONOSPACE") {
      message += run.inner;
      textStyle.push(`${start}:${run.inner.length}:MONOSPACE`);
    } else {
      const nested = toTextStyle(run.inner);
      message += nested.message;
      textStyle.push(`${start}:${nested.message.length}:${run.style}`);
      for (const entry of nested.textStyle) textStyle.push(shift(entry, start));
    }
    i = run.end;
  }
  return { message, textStyle };
}

interface Run {
  readonly style: Style;
  readonly inner: string;
  /** Index just past the closing marker. */
  readonly end: number;
}

/** The styled run opening at `i`, or `undefined` when no marker opens a valid run there. */
function runAt(text: string, i: number): Run | undefined {
  const found = MARKERS.find(([marker]) => text.startsWith(marker, i));
  if (found === undefined) return undefined;
  const [marker, style] = found;
  const open = i + marker.length;
  const close = text.indexOf(marker, open);
  if (close <= open) return undefined;
  const inner = text.slice(open, close);
  if (inner.trim() !== inner) return undefined;
  if (marker === "_" && insideWord(text, i, close + 1)) return undefined;
  return { style, inner, end: close + marker.length };
}

/** An underscore with a letter or digit on the outer side of either marker is part of a word. */
function insideWord(text: string, before: number, after: number): boolean {
  return WORD.test(text[before - 1] ?? "") || WORD.test(text[after] ?? "");
}

function shift(entry: string, by: number): string {
  const [start, length, style] = entry.split(":");
  return `${Number(start) + by}:${length}:${style}`;
}
