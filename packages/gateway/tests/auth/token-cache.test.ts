import { describe, expect, it, vi } from "vitest";
import { createTokenCache } from "../../src/auth/token-cache.js";

function setup(expiresInS?: number) {
  let t = 0;
  let n = 0;
  const fetchToken = vi.fn(async () => {
    n += 1;
    return { value: `tok${n}`, ...(expiresInS === undefined ? {} : { expiresInS }) };
  });
  const cache = createTokenCache({ fetchToken, now: () => t });
  return {
    cache,
    fetchToken,
    at: (s: number) => {
      t = s * 1000;
    },
  };
}

describe("createTokenCache", () => {
  it("shares one fetch between concurrent callers", async () => {
    const { cache, fetchToken } = setup(120);
    const r = await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(r).toEqual(["tok1", "tok1", "tok1"]);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("serves from cache until the margin, then refetches", async () => {
    const { cache, fetchToken, at } = setup(120);
    await cache.get();
    at(59);
    expect(await cache.get()).toBe("tok1");
    at(61);
    expect(await cache.get()).toBe("tok2");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("uses the default ttl when expiresInS is not positive", async () => {
    const { cache, at } = setup(0);
    await cache.get();
    at(7139);
    expect(await cache.get()).toBe("tok1");
    at(7141);
    expect(await cache.get()).toBe("tok2");
  });

  it("force fetches even when fresh", async () => {
    const { cache, fetchToken } = setup(120);
    await cache.get();
    expect(await cache.get({ force: true })).toBe("tok2");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("rejects every caller with the same error and does not cache it", async () => {
    const err = new Error("boom");
    const fetchToken = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce({ value: "ok" });
    const cache = createTokenCache({ fetchToken });
    const r = await Promise.allSettled([cache.get(), cache.get()]);
    expect(r.map((x) => (x.status === "rejected" ? x.reason : null))).toEqual([err, err]);
    expect(await cache.get()).toBe("ok");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("clear forgets the token and an in-flight fetch does not repopulate it", async () => {
    const { cache, fetchToken } = setup(120);
    await cache.get();
    cache.clear();
    expect(await cache.get()).toBe("tok2");
    const inflight = cache.get({ force: true });
    cache.clear();
    await inflight;
    expect(await cache.get()).toBe("tok4");
    expect(fetchToken).toHaveBeenCalledTimes(4);
  });

  it("passes the starting caller's signal to fetchToken", async () => {
    const { cache, fetchToken } = setup(120);
    const ctl = new AbortController();
    await cache.get({ signal: ctl.signal });
    expect(fetchToken).toHaveBeenCalledWith(ctl.signal);
  });
});
