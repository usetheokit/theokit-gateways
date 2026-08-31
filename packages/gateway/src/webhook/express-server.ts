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
 * all ten adapters.
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
  setEncoding(encoding: string): unknown;
  on(event: string, listener: (arg: never) => void): unknown;
}

/** What a started listener must be able to do. `http.Server` satisfies it. */
export interface ListenerLike {
  close(cb?: (err?: Error) => void): unknown;
}

/** What can start a listener. Express's app satisfies it. */
export interface ListenableApp {
  listen(port: number, cb: () => void): ListenerLike;
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
 * @param tag the package name for the diagnostic, so a reader knows which router is complaining
 */
export function rawBodyCapture(tag: string) {
  // `unknown` rather than `RawBodyRequest`, and that is a type-system requirement rather than
  // laziness: a handler parameter is CONTRAVARIANT, so for express to accept this middleware the
  // parameter must be a SUPERTYPE of express's own `Request`. Narrowed on the first line, where the
  // shape this actually needs is stated once.
  return (rawReq: unknown, _res: unknown, next: (err?: unknown) => void): void => {
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
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      buf += chunk;
    });
    req.on("end", () => {
      (req as unknown as { rawBody: string }).rawBody = buf;
      next();
    });
    req.on("error", (err: unknown) => next(err));
  };
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
      await new Promise<void>((resolve) => {
        listener = opts.app.listen(opts.port, () => resolve());
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
