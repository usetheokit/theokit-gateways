/**
 * A `text/event-stream` reader over a `fetch` body: one callback per complete frame, in order.
 */

/** One server-sent event: its `id:` and its `data:` lines joined with `\n`. */
export interface SseFrame {
  readonly id: number | undefined;
  readonly data: string;
}

/**
 * Read `body` to its end, calling `onFrame` for each frame and awaiting it before the next. A frame
 * still incomplete when the body ends is dropped; a frame with no data (a comment) is skipped.
 */
export async function readSseFrames(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: SseFrame) => Promise<void>,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = normalizeLineEnds(buffer + decoder.decode(value, { stream: true }));
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const frame = parseFrame(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (frame !== undefined) await onFrame(frame);
        end = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * `\r\n` and `\r` become `\n`, except a `\r` that ends the text: the `\n` that may complete it is
 * in the next chunk, and turning it into `\n` now would make one line end read as two.
 */
function normalizeLineEnds(text: string): string {
  const held = text.endsWith("\r") ? "\r" : "";
  const body = held === "" ? text : text.slice(0, -1);
  return body.replace(/\r\n?/g, "\n") + held;
}

function parseFrame(text: string): SseFrame | undefined {
  const lines = text.split("\n");
  const data = lines.filter((line) => line.startsWith("data:")).map(dataValue);
  if (data.length === 0) return undefined;
  const idLine = lines.findLast((line) => line.startsWith("id:"));
  return { id: idLine === undefined ? undefined : eventId(idLine), data: data.join("\n") };
}

/** A `data:` line's value; one space after the colon belongs to the syntax, not the value. */
function dataValue(line: string): string {
  const value = line.slice(5);
  return value.startsWith(" ") ? value.slice(1) : value;
}

function eventId(line: string): number | undefined {
  const parsed = Number(line.slice(3).trim());
  return Number.isInteger(parsed) ? parsed : undefined;
}
