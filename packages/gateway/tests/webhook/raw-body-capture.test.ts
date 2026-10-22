import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { rawBodyCapture } from "../../src/webhook/express-server.js";

/** A request stream with the members `rawBodyCapture` reads. */
class FakeRequest extends EventEmitter {
  readableEnded = false;
  complete = false;
  rawBody: string | undefined;
  constructor(readonly headers: Record<string, string> = {}) {
    super();
  }
  setEncoding(): this {
    return this;
  }
}

/** Run the middleware over `req` and resolve with what it passed to `next`. */
function capture(req: FakeRequest, options?: { maxBytes?: number }): { next: Promise<unknown[]> } {
  let resolveNext: (args: unknown[]) => void = () => undefined;
  const next = new Promise<unknown[]>((resolve) => {
    resolveNext = resolve;
  });
  rawBodyCapture("test-router", options)(req, {}, (...args: unknown[]) => resolveNext(args));
  return { next };
}

describe("rawBodyCapture", () => {
  it("attaches the body as rawBody when it fits maxBytes", async () => {
    const req = new FakeRequest();
    const { next } = capture(req, { maxBytes: 10 });

    req.emit("data", "0123456789");
    req.emit("end");

    expect(await next).toEqual([]);
    expect(req.rawBody).toBe("0123456789");
  });

  it("refuses with 413 once the streamed body passes maxBytes, without a content-length", async () => {
    const req = new FakeRequest();
    const { next } = capture(req, { maxBytes: 10 });

    req.emit("data", "012345");
    req.emit("data", "6789A");

    const [err] = await next;
    expect(err).toMatchObject({ status: 413 });
    expect(String((err as Error).message)).toContain("test-router");
    expect(req.rawBody).toBeUndefined();
  });

  it("refuses with 413 before reading when content-length already passes maxBytes", async () => {
    const req = new FakeRequest({ "content-length": "11" });
    const { next } = capture(req, { maxBytes: 10 });

    const [err] = await next;

    expect(err).toMatchObject({ status: 413 });
  });

  it("counts bytes, not characters", async () => {
    const req = new FakeRequest();
    const { next } = capture(req, { maxBytes: 4 });

    req.emit("data", "ééé");

    const [err] = await next;
    expect(err).toMatchObject({ status: 413 });
  });

  it("keeps no limit when maxBytes is not given", async () => {
    const req = new FakeRequest();
    const { next } = capture(req);

    req.emit("data", "x".repeat(100_000));
    req.emit("end");

    expect(await next).toEqual([]);
    expect(req.rawBody).toHaveLength(100_000);
  });
});
