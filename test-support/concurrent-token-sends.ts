interface Call {
  url: string;
}

interface Sender {
  connect(): Promise<unknown>;
  sendMessage(out: { channel: { id: string; type: "dm" }; text: string }): Promise<{ ok: boolean }>;
}

/**
 * Two concurrent sends on an empty token cache must make one token request.
 * A token inside the refresh margin is never served from the cache, so the cache stays empty.
 */
export async function expectOneTokenRequestForConcurrentSends(options: {
  expect: (value: unknown) => { toBe(v: unknown): void; toHaveLength(n: number): void };
  fakeFetch: (answer: (c: any) => unknown) => { fetch: unknown; calls: Call[] };
  ok: (c: any) => unknown;
  started: (fetch: any) => Sender;
  isTokenRequest: (url: string) => boolean;
}): Promise<void> {
  const { fetch, calls } = options.fakeFetch((c) => {
    const answer = options.ok(c) as any;
    if (answer.access_token) answer.expires_in = "1";
    if (answer.data?.access_token) answer.data.expires_in = 1;
    return answer;
  });
  const a = options.started(fetch);
  await a.connect();
  calls.length = 0;
  const out = { channel: { id: "u1", type: "dm" as const }, text: "hi" };
  const results = await Promise.all([a.sendMessage(out), a.sendMessage(out)]);
  options.expect(results.every((r) => r.ok)).toBe(true);
  options.expect(calls.filter((c) => options.isTokenRequest(c.url))).toHaveLength(1);
}
