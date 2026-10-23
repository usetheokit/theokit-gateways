/**
 * The half of an Express webhook server that is the same for every platform.
 *
 * `gateway-line` and `gateway-sms` each ship one, and they shared 101 of ~170 lines: the lazy
 * `express` load, the raw-body capture with the hang it documents, and the start/stop lifecycle.
 * What differs is signature verification, body parsing and routing, which are genuinely
 * per-platform (#89).
 *
 * The duplication had already been paid for. Commit `11000cc` fixed a write-once latch that made
 * `start()` after `stop()` return without creating a listener — a port nothing answers on, with no
 * error and no log — and it had to fix it in BOTH files, because the latch lives in the copied
 * half. That is the DRY test verbatim: change it here, change it there.
 *
 * ## Why here, and not in a new package
 *
 * The core had no HTTP concern, and `express` is a peer dependency of exactly the two packages that
 * duplicate this — so the obvious objection to putting it here is that it would impose express on
 * every adapter.
 *
 * It does not, because nothing here imports express. Every shape below is structural: a request is
 * whatever has `readableEnded` and `on`, a listener is whatever has `listen` and `close`. The
 * packages that use express keep declaring it; this module never learns the name.
 *
 * Exported rather than internal: the two packages that consume it are separate npm packages, so
 * "internal to this repository" is not a thing the module system can express.
 *
 * @public
 */

/** What the capture middleware reads. Express's `Request` satisfies it; so does a bare stream. */
export interface RawBodyRequest {
  readonly readableEnded?: boolean;
  readonly complete?: boolean;
  readonly headers?: Readonly<Record<string, string | string[] | undefined>>;
  setEncoding(encoding: string): unknown;
  on(event: string, listener: (arg: never) => void): unknown;
}

/** What a started listener must be able to do. `http.Server` satisfies it. */
export interface ListenerLike {
  close(cb?: (err?: Error) => void): unknown;
  /** Where Express 4's `listen` reports a failure to bind; `http.Server` has it. */
  once?(event: "error", listener: (err: Error) => void): unknown;
}

/**
 * What can start a listener. Express's app satisfies it: Express 5 passes a failure to bind to the
 * callback, Express 4 only emits it on the returned server.
 */
export interface ListenableApp {
  listen(port: number, cb: (err?: Error) => void): ListenerLike;
}

/**
 * Load a peer dependency, or fail with a message that says what to install.
 *
 * The error is the point. A bare `Cannot find module 'express'` reaches a consumer who did not
 * write the import and cannot tell whether the package is broken or a step is missing.
 */
export async function loadPeer<T>(
  load: () => Promise<unknown>,
  onMissing: () => never,
): Promise<T> {
  try {
    const mod = await load();
    // Both ESM and CJS shapes: `import()` on a CJS module puts the export under `default`.
    return ((mod as { default?: T }).default ?? (mod as T)) as T;
  } catch {
    onMissing();
  }
}

/**
 * Middleware that captures the RAW request body before anything parses it.
 *
 * Every provider signs the exact bytes, so a body that was parsed and re-serialised hashes
 * differently and fails verification for a correct request. The bytes are attached as `rawBody`.
 *
 * With `maxBytes`, a body larger than that many bytes is refused before it is held. The rest of
 * the stream is read and dropped, and once it ends the middleware answers 413 with the JSON body
 * `{ "error": "request body too large" }` itself; `next` is not called. A route that must stay
 * public (a provider dials in) sets it, or any client can stream a body until the heap runs out.
 * The refusal is answered here rather than handed to `next` as an error because Express's final
 * handler writes an error as an HTML page carrying its stack whenever `NODE_ENV` is not
 * `production`, and these routes answer anyone.
 *
 * The middleware settles once: after a refusal, more data, the end of the stream or a stream
 * error do nothing, and after a stream error the end of the stream does nothing.
 *
 * @param tag the package name for the diagnostic, so a reader knows which router is complaining
 * @param options `maxBytes`, the largest body accepted; no limit when absent
 * @throws RangeError when `maxBytes` is not a finite number of zero or more
 */
export function rawBodyCapture(tag: string, options: RawBodyCaptureOptions = {}) {
  const { maxBytes } = options;
  if (maxBytes !== undefined && !(Number.isFinite(maxBytes) && maxBytes >= 0)) {
    throw new RangeError(
      `[${tag}] rawBodyCapture: maxBytes must be a finite number of zero or more, got ${maxBytes}`,
    );
  }
  // `unknown` rather than `RawBodyRequest`, and that is a type-system requirement rather than
  // laziness: a handler parameter is CONTRAVARIANT, so for express to accept this middleware the
  // parameter must be a SUPERTYPE of express's own `Request`. Narrowed on the first line, where the
  // shape this actually needs is stated once.
  return (rawReq: unknown, rawRes: unknown, next: (err?: unknown) => void): void => {
    const req = rawReq as RawBodyRequest;
    // Someone else already drained the stream — a global `express.json()` or `express.urlencoded()`
    // mounted ahead of this router is the usual cause. Without this branch `req.on("end")` never
    // fires for a stream that already ended, `next()` is never called, and the request HANGS with
    // no response: the provider times out and retries, and nothing is logged anywhere. Failing
    // loudly and continuing is strictly better — verification then refuses the empty body with a
    // 401, which is at least a visible symptom pointing at the real cause.
    if (req.readableEnded === true || req.complete === true) {
      process.stderr.write(
        `[${tag}] raw body already consumed before signature capture — mount this router ` +
          "BEFORE any global body parser, or signature verification cannot see the bytes it " +
          "must hash\n",
      );
      (req as unknown as { rawBody: string }).rawBody = "";
      next();
      return;
    }
    let buf = "";
    let bytes = 0;
    // `refused` drops what is left of the body; `settled` keeps every path to one answer.
    let refused = maxBytes !== undefined && declaredLength(req) > maxBytes;
    let settled = false;
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      if (refused || settled) return;
      bytes += Buffer.byteLength(chunk);
      if (maxBytes !== undefined && bytes > maxBytes) {
        refused = true;
        buf = "";
        return;
      }
      buf += chunk;
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      if (refused) {
        answerTooLarge(rawRes as JsonResponse, tag, maxBytes ?? 0);
        return;
      }
      (req as unknown as { rawBody: string }).rawBody = buf;
      next();
    });
    req.on("error", (err: unknown) => {
      if (settled) return;
      settled = true;
      // A client that aborts a refused body has nobody left to answer.
      if (refused) return;
      next(err);
    });
  };
}

/** Options for {@link rawBodyCapture}. */
export interface RawBodyCaptureOptions {
  /** The largest body accepted, in bytes. A larger one is refused with 413. No limit when absent. */
  readonly maxBytes?: number;
}

/** The `content-length` the client declared, or 0 when it declared none or an unreadable one. */
function declaredLength(req: RawBodyRequest): number {
  const value = req.headers?.["content-length"];
  const declared = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(declared) ? declared : 0;
}

/** What the refusal writes to. Express's `Response` satisfies it. */
interface JsonResponse {
  status(code: number): { json(body: unknown): unknown };
}

/** Answer 413 as JSON, and say on stderr which router refused and at what limit. */
function answerTooLarge(res: JsonResponse, tag: string, maxBytes: number): void {
  process.stderr.write(`[${tag}] refused a request (413): body larger than ${maxBytes} bytes\n`);
  res.status(413).json({ error: "request body too large" });
}

/**
 * The start/stop pair, with the latches that make a restart a restart.
 *
 * Both flags used to be write-once, in both packages. After a `stop()`, `start()` hit `if (started)`
 * and returned without creating a listener — the server was silently dead — and the next `stop()`
 * was a no-op for the same reason, in the other direction. Anything that restarts a gateway hit it:
 * a config reload, a reconnect after a network fault, a supervisor cycling a process in-band.
 *
 * `injected` is for the case where the caller owns the app: there is no listener to open or close,
 * and `start()`/`stop()` must still be callable and idempotent.
 *
 * `start()` rejects with the error the bind failed with (`EADDRINUSE` for a port another listener
 * holds), under Express 4 and 5 alike, and a later `start()` tries again.
 */
export function listenerLifecycle(opts: {
  readonly app: ListenableApp;
  readonly port: number;
  readonly injected: boolean;
}): { start(): Promise<void>; stop(): Promise<void> } {
  let started = false;
  let stopped = false;
  let listener: ListenerLike | undefined;

  return {
    async start(): Promise<void> {
      if (started || opts.injected) {
        started = true;
        return;
      }
      // Cleared here rather than in stop(): a server that was stopped and is starting again is no
      // longer stopped, and leaving the flag latched made the NEXT stop() a no-op.
      stopped = false;
      // A port another process holds used to resolve this as started: Express 5 hands the bind
      // error to the callback, which ignored it, and `connect()` answered true over no listener.
      await new Promise<void>((resolve, reject) => {
        const settle = (err?: Error): void => {
          if (err === undefined) resolve();
          else reject(err);
        };
        const current = opts.app.listen(opts.port, settle);
        listener = current;
        current.once?.("error", settle);
      }).catch((err: unknown) => {
        listener = undefined;
        throw err;
      });
      started = true;
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      // Resetting `started` is what makes a restart a restart.
      started = false;
      const current = listener;
      listener = undefined;
      if (current === undefined) return;
      await new Promise<void>((resolve) => {
        current.close(() => resolve());
      });
    },
  };
}
