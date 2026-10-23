import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

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

/** The members of an Express response the refusal writes. */
class FakeResponse {
  readonly answers: Array<{ status: number; body: unknown }> = [];
  private pending = 0;
  status(code: number): { json(body: unknown): void } {
    this.pending = code;
    return {
      json: (body: unknown) => {
        this.answers.push({ status: this.pending, body });
      },
    };
  }
}

/** Run the middleware over `req` and resolve with what it passed to `next`. */
function capture(req: FakeRequest, options?: { maxBytes?: number }): { next: Promise<unknown[]> } {
  let resolveNext: (args: unknown[]) => void = () => undefined;
  const next = new Promise<unknown[]>((resolve) => {
    resolveNext = resolve;
  });
  rawBodyCapture("test-router", options)(req, new FakeResponse(), (...args: unknown[]) =>
    resolveNext(args),
  );
  return { next };
}

/** Run the middleware over `req`, counting every `next` call and every answer it writes. */
function refusal(
  req: FakeRequest,
  maxBytes: number,
): { nextCalls: unknown[][]; res: FakeResponse } {
  const nextCalls: unknown[][] = [];
  const res = new FakeResponse();
  rawBodyCapture("test-router", { maxBytes })(req, res, (...args: unknown[]) => {
    nextCalls.push(args);
  });
  return { nextCalls, res };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rawBodyCapture", () => {
  it("attaches the body as rawBody when it fits maxBytes", async () => {
    const req = new FakeRequest();
    const { next } = capture(req, { maxBytes: 10 });

    req.emit("data", "0123456789");
    req.emit("end");

    expect(await next).toEqual([]);
    expect(req.rawBody).toBe("0123456789");
  });

  it("answers 413 as JSON once the streamed body passes maxBytes, without a content-length", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const req = new FakeRequest();
    const { nextCalls, res } = refusal(req, 10);

    req.emit("data", "012345");
    req.emit("data", "6789A");
    req.emit("end");

    expect(res.answers).toEqual([{ status: 413, body: { error: "request body too large" } }]);
    expect(nextCalls).toEqual([]);
    expect(req.rawBody).toBeUndefined();
  });

  it("answers 413 before holding a byte when content-length already passes maxBytes", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const req = new FakeRequest({ "content-length": "11" });
    const { nextCalls, res } = refusal(req, 10);

    req.emit("data", "0123456789A");
    req.emit("end");

    expect(res.answers).toEqual([{ status: 413, body: { error: "request body too large" } }]);
    expect(nextCalls).toEqual([]);
    expect(req.rawBody).toBeUndefined();
  });

  it("counts bytes, not characters", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const req = new FakeRequest();
    const { res } = refusal(req, 4);

    req.emit("data", "ééé");
    req.emit("end");

    expect(res.answers.map((answer) => answer.status)).toEqual([413]);
  });

  it("after a refusal, more data and the end of the stream answer nothing again", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const req = new FakeRequest();
    const { nextCalls, res } = refusal(req, 10);

    req.emit("data", "0123456789AB");
    req.emit("data", "more");
    req.emit("end");
    req.emit("end");

    expect(res.answers).toHaveLength(1);
    expect(nextCalls).toEqual([]);
    expect(req.rawBody).toBeUndefined();
  });

  it("a stream error after a refusal calls next not at all", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const req = new FakeRequest();
    const { nextCalls } = refusal(req, 10);

    req.emit("data", "0123456789AB");
    req.emit("error", new Error("aborted"));

    expect(nextCalls).toEqual([]);
  });

  it("a stream error before any refusal is passed to next once", () => {
    const req = new FakeRequest();
    const { nextCalls } = refusal(req, 10);

    req.emit("data", "0123");
    req.emit("error", new Error("aborted"));
    req.emit("end");

    expect(nextCalls).toHaveLength(1);
    expect(nextCalls[0]?.[0]).toMatchObject({ message: "aborted" });
  });

  it.each([Number.NaN, -1, Number.POSITIVE_INFINITY])(
    "throws a RangeError for maxBytes %s",
    (maxBytes) => {
      expect(() => rawBodyCapture("test-router", { maxBytes })).toThrow(RangeError);
    },
  );

  it("keeps no limit when maxBytes is not given", async () => {
    const req = new FakeRequest();
    const { next } = capture(req);

    req.emit("data", "x".repeat(100_000));
    req.emit("end");

    expect(await next).toEqual([]);
    expect(req.rawBody).toHaveLength(100_000);
  });
});
