import { describe, expect, it } from "vitest";
import { XApi, XApiError } from "../src/api.js";
import type { XAdapterOptions, XFetch } from "../src/index.js";

function setup(tokenStatus = 200, extra: Partial<XAdapterOptions> = {}) {
  const urls: string[] = [];
  let tokenPosts = 0;
  const json = (status: number, body: unknown) => ({
    status,
    text: async () => JSON.stringify(body),
  });
  const fetchFake: XFetch = async (url) => {
    urls.push(url);
    if (url.endsWith("/2/oauth2/token")) {
      tokenPosts++;
      await new Promise((r) => setTimeout(r, 20));
      return tokenStatus === 200
        ? json(200, {
            access_token: `at${tokenPosts}`,
            refresh_token: `rt${tokenPosts}`,
            expires_in: 7200,
          })
        : json(tokenStatus, { error: "invalid_request" });
    }
    if (url.includes("/mentions")) return json(200, { data: [] });
    return json(201, { data: { id: "r1" } });
  };
  const api = new XApi(
    {
      userId: "100",
      username: "@theobot",
      clientId: "cid",
      clientSecret: "csec",
      refreshToken: "rt0",
      fetch: fetchFake,
      ...extra,
    } as XAdapterOptions,
    () => 0,
  );
  return { api, posts: () => tokenPosts, urls };
}

describe("XApi single-flight refresh", () => {
  it("shares one token request between concurrent refresh calls", async () => {
    const { api, posts } = setup();
    const [a, b] = await Promise.all([api.refresh(), api.refresh()]);
    expect(posts()).toBe(1);
    expect(a).toBe("at1");
    expect(b).toBe(a);
  });

  it("shares one token request between a mentions call and a reply", async () => {
    const { api, posts, urls } = setup();
    await Promise.all([api.mentions(undefined, 10), api.reply("hi", "5")]);
    expect(posts()).toBe(1);
    expect(urls.filter((u) => u.includes("/mentions") || u.endsWith("/2/tweets"))).toHaveLength(2);
  });

  it("rejects every caller on failure and does not cache the failure", async () => {
    const { api, posts } = setup(400);
    const results = await Promise.allSettled([api.refresh(), api.refresh()]);
    for (const r of results) {
      expect(r.status).toBe("rejected");
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(XApiError);
    }
    expect(posts()).toBe(1);
    await expect(api.refresh()).rejects.toBeInstanceOf(XApiError);
    expect(posts()).toBe(2);
  });

  it("calls onRefreshToken once for one rotation", async () => {
    const rotated: string[] = [];
    const { api } = setup(200, { onRefreshToken: (t) => void rotated.push(t) });
    await Promise.all([api.refresh(), api.refresh()]);
    expect(rotated).toEqual(["rt1"]);
  });
});
