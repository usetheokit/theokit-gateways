/**
 * Reading a body stream with a size limit: the request body and a key-set document both come from
 * a party the verifier does not trust to stop.
 *
 * @internal
 */

import { Buffer } from "node:buffer";

/** A stream as text, or `undefined` once it passes `maxBytes`. Reads no further. */
export async function readBoundedStream(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string | undefined> {
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
