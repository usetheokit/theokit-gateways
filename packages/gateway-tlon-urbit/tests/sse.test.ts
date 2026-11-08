import { describe, expect, it } from "vitest";

import { readSseFrames } from "../src/sse.js";

function bodyOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function frames(
  chunks: readonly string[],
): Promise<Array<{ id: number | undefined; data: string }>> {
  const out: Array<{ id: number | undefined; data: string }> = [];
  await readSseFrames(bodyOf(chunks), async (frame) => {
    out.push(frame);
  });
  return out;
}

describe("readSseFrames", () => {
  it("yields whole frames with id and data from a body split across chunks", async () => {
    const result = await frames(["id: 1\nda", 'ta: {"a":1}\n', "\nid: 2\ndata: {}\n\n"]);

    expect(result).toEqual([
      { id: 1, data: '{"a":1}' },
      { id: 2, data: "{}" },
    ]);
  });

  it("reads CRLF line ends, joins several data lines and skips comments", async () => {
    const result = await frames([": keep-alive\r\n\r\nid:3\r\ndata: one\r\ndata: two\r\n\r\n"]);

    expect(result).toEqual([{ id: 3, data: "one\ntwo" }]);
  });

  it("reads a CRLF split between two chunks as one line end, not a frame boundary", async () => {
    expect(await frames(["id: 5\r", "\ndata: a\r", "\n\r\n"])).toEqual([{ id: 5, data: "a" }]);
  });

  it("drops a partial frame left when the body ends", async () => {
    expect(await frames(["id: 4\ndata: {}"])).toEqual([]);
  });
});
