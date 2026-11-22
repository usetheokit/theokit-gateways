/**
 * Internal helpers the HTTP-calling adapters share: run a request, turn a non-2xx answer or a
 * rejected fetch into a typed failure, and map a thrown failure to a failed `SendResult`.
 * Bundled into each adapter; not part of any public API.
 */

/** The fetch-shaped seam every adapter exposes. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{
  status: number;
  text(): Promise<string>;
  headers?: { get(name: string): string | null };
}>;

/** The shape of a failed send result. */
export type FailedSend = {
  readonly ok: false;
  readonly error: { code: string; message: string; platformCode?: string };
};

/** `sendErrorFromHttp` of `@theokit/gateway`, passed in so this module imports nothing. */
export type SendErrorFromHttp<R> = (
  status: number,
  message: string,
  extra: { retryAfter?: string; platformCode?: string },
) => R;

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A non-2xx HTTP answer, with what a caller needs to retry. */
export class HttpFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfter: string | undefined,
    readonly platformCode: string | undefined,
  ) {
    super(message);
  }
}

/** The fetch itself rejected, so no answer came. */
export class NetworkFailure extends Error {}

/** Run the fetch and read the body; a rejection of either becomes a `NetworkFailure`. */
export async function fetchText(
  doFetch: FetchLike,
  url: string,
  init: Parameters<FetchLike>[1],
): Promise<{ status: number; retryAfter: string | undefined; text: string }> {
  try {
    const res = await doFetch(url, init);
    const retryAfter = res.headers?.get("retry-after") ?? undefined;
    return { status: res.status, retryAfter, text: await res.text() };
  } catch (err) {
    throw new NetworkFailure(messageOf(err));
  }
}

/** Throw an `HttpFailure` for a non-2xx answer, keeping the body's platform code when it has one. */
export function assertHttpOk(
  who: string,
  res: { status: number; retryAfter: string | undefined },
  text: string,
  codeOf: (body: { code?: unknown; error?: unknown } | null) => unknown,
): void {
  if (res.status >= 200 && res.status < 300) return;
  let code: unknown;
  try {
    code = codeOf(JSON.parse(text));
  } catch {
    code = undefined;
  }
  throw new HttpFailure(
    res.status,
    `${who} answered HTTP ${res.status}`,
    res.retryAfter,
    code === undefined || code === null ? undefined : String(code),
  );
}

/** The failed `SendResult` for a thrown error: HTTP status, rejected fetch, or anything else. */
export function failureOf<R>(err: unknown, fromHttp: SendErrorFromHttp<R>): R | FailedSend {
  if (err instanceof HttpFailure) {
    return fromHttp(err.status, err.message, {
      ...(err.retryAfter === undefined ? {} : { retryAfter: err.retryAfter }),
      ...(err.platformCode === undefined ? {} : { platformCode: err.platformCode }),
    });
  }
  const code = err instanceof NetworkFailure ? "network_error" : "platform_error";
  return { ok: false, error: { code, message: messageOf(err) } };
}

/** A 200 answer whose body carries a platform error code; it stays `platform_error`. */
export function bodyFailure(message: string, code: unknown): FailedSend {
  return { ok: false, error: { code: "platform_error", message, platformCode: String(code) } };
}
