interface Sender {
  connect(): Promise<unknown>;
  sendMessage(out: { channel: { id: string; type: "dm" }; text: string }): Promise<{ ok: boolean }>;
}

/**
 * Runs two concurrent sends on an empty token cache and returns what happened, so each adapter
 * test keeps its own assertions. A token inside the refresh margin is never served from the
 * cache, so the cache stays empty.
 */
export async function concurrentSendsOnEmptyCache<C extends { url: string }, F>(options: {
  fakeFetch: (answer: (c: C) => unknown) => { fetch: F; calls: C[] };
  ok: (c: C) => unknown;
  started: (fetch: F) => Sender;
}): Promise<{ results: { ok: boolean }[]; calls: C[] }> {
  const { fetch, calls } = options.fakeFetch((c) => {
    const answer = options.ok(c) as {
      access_token?: unknown;
      expires_in?: unknown;
      data?: { access_token?: unknown; expires_in?: unknown };
    };
    if (answer.access_token) answer.expires_in = "1";
    if (answer.data?.access_token) answer.data.expires_in = 1;
    return answer;
  });
  const a = options.started(fetch);
  await a.connect();
  calls.length = 0;
  const out = { channel: { id: "u1", type: "dm" as const }, text: "hi" };
  const results = await Promise.all([a.sendMessage(out), a.sendMessage(out)]);
  return { results, calls };
}
