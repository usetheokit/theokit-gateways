/**
 * `readBoundedStream` reads a request body or a key-set document, both sent by a party the verifier
 * does not trust to stop: the text up to the limit, and nothing past it.
 */

import { describe, expect, it } from "vitest";

import { readBoundedStream } from "../src/bounded-stream.js";

function streamOf(...chunks: string[]): {
  stream: ReadableStream<Uint8Array>;
  pulled: () => number;
} {
  let pulled = 0;
  const encoded = chunks.map((chunk) => new TextEncoder().encode(chunk));
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = encoded[pulled];
      pulled += 1;
      if (next === undefined) controller.close();
      else controller.enqueue(next);
    },
  });
  return { stream, pulled: () => pulled };
}

describe("readBoundedStream", () => {
  it("reads a body split across chunks as one text", async () => {
    const { stream } = streamOf('{"a":', '"é"}');

    await expect(readBoundedStream(stream, 100)).resolves.toBe('{"a":"é"}');
  });

  it("reads a body of exactly the limit", async () => {
    const { stream } = streamOf("abc", "de");

    await expect(readBoundedStream(stream, 5)).resolves.toBe("abcde");
  });

  it("answers undefined for a body one byte over the limit", async () => {
    const { stream } = streamOf("abc", "def");

    await expect(readBoundedStream(stream, 5)).resolves.toBeUndefined();
  });

  it("counts bytes, not characters", async () => {
    const { stream } = streamOf("éé");

    await expect(readBoundedStream(stream, 3)).resolves.toBeUndefined();
  });

  it("stops pulling once the limit is passed", async () => {
    const { stream, pulled } = streamOf("aaaa", "bbbb", "cccc", "dddd");

    await readBoundedStream(stream, 5);

    // Four chunks and the close would be five pulls; the read stops after the second chunk.
    expect(pulled()).toBeLessThan(4);
  });

  it("reads a null body as empty text", async () => {
    await expect(readBoundedStream(null, 0)).resolves.toBe("");
  });
});
