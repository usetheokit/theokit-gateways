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

describe("credentialStore", () => {
  it("reads the stored token first and saves the rotated one", async () => {
    const data = new Map<string, string>([["x-refresh-token:100", "stored"]]);
    const store = {
      get: async (k: string) => data.get(k),
      set: async (k: string, v: string) => void data.set(k, v),
    };
    const bodies: string[] = [];
    const rotated: string[] = [];
    const fetchFake: XFetch = async (_url, init) => {
      bodies.push(init.body ?? "");
      return {
        status: 200,
        text: async () =>
          JSON.stringify({ access_token: "at", refresh_token: "new", expires_in: 7200 }),
      };
    };
    const api = new XApi(
      {
        userId: "100",
        username: "@theobot",
        clientId: "cid",
        clientSecret: "csec",
        refreshToken: "env",
        credentialStore: store,
        onRefreshToken: (t: string) => void rotated.push(t),
        fetch: fetchFake,
      } as XAdapterOptions,
      () => 0,
    );
    await api.refresh();
    expect(new URLSearchParams(bodies[0]).get("refresh_token")).toBe("stored");
    expect(data.get("x-refresh-token:100")).toBe("new");
    expect(rotated).toEqual(["new"]);
  });
});

describe("credentialStore failures", () => {
  function make(data: Map<string, string>, failSets: { n: number }) {
    const store = {
      get: async (k: string) => data.get(k),
      set: async (k: string, v: string) => {
        if (failSets.n-- > 0) throw new Error("disk full");
        data.set(k, v);
      },
    };
    let n = 0;
    const fetchFake: XFetch = async (url) => {
      if (url.endsWith("/2/oauth2/token")) {
        n++;
        return {
          status: 200,
          text: async () =>
            JSON.stringify({ access_token: `at${n}`, refresh_token: `rt${n}`, expires_in: 7200 }),
        };
      }
      return { status: 200, text: async () => JSON.stringify({ data: [] }) };
    };
    return new XApi(
      {
        userId: "100",
        username: "@theobot",
        clientId: "cid",
        clientSecret: "csec",
        refreshToken: "env",
        credentialStore: store,
        fetch: fetchFake,
      } as XAdapterOptions,
      () => 0,
    );
  }

  it("retries a failed save before any later call succeeds", async () => {
    const data = new Map<string, string>();
    const api = make(data, { n: 1 });
    await expect(api.refresh()).rejects.toThrow("disk full");
    expect(data.size).toBe(0);
    await api.mentions(undefined, 5); // retries the unsaved rt1, then refreshes to rt2
    expect(data.get("x-refresh-token:100")).toBe("rt2");
  });

  it("retries a failed save before a direct refresh request (reconnect)", async () => {
    const data = new Map<string, string>();
    const api = make(data, { n: 1 });
    await expect(api.refresh()).rejects.toThrow("disk full");
    await api.refresh(); // rt1 is written before rotating to rt2
    expect(data.get("x-refresh-token:100")).toBe("rt2");
  });

  it("keeps the newer token when a held retry of an older one finishes late", async () => {
    const data = new Map<string, string>();
    let failFirst = true;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let heldOnce = false;
    const store = {
      get: async (k: string) => data.get(k),
      set: async (k: string, v: string) => {
        if (failFirst) {
          failFirst = false;
          throw new Error("disk full");
        }
        if (v === "rt1" && !heldOnce) {
          heldOnce = true;
          await gate;
        }
        data.set(k, v);
      },
    };
    let n = 0;
    const opts = {
      userId: "100",
      username: "@theobot",
      clientId: "cid",
      clientSecret: "csec",
      refreshToken: "env",
      credentialStore: store,
      fetch: async (url: string) =>
        url.endsWith("/2/oauth2/token")
          ? {
              status: 200,
              text: async () =>
                JSON.stringify({
                  access_token: `at${++n}`,
                  refresh_token: `rt${n}`,
                  expires_in: 7200,
                }),
            }
          : { status: 200, text: async () => JSON.stringify({ data: [] }) },
    } as unknown as XAdapterOptions;
    const api = new XApi(opts, () => 0);
    await expect(api.refresh()).rejects.toThrow("disk full"); // rt1 unsaved
    const a = api.mentions(undefined, 5); // retry of rt1, held
    await new Promise((r) => setTimeout(r, 10));
    const b = api.refresh(); // rotation to rt2, queued behind the held write
    await new Promise((r) => setTimeout(r, 10));
    release();
    await Promise.all([a, b]);
    // a restart reads the store, which must hold the newer token
    expect(await store.get("x-refresh-token:100")).toBe("rt2");
  });

  it("lets an empty stored value win over the configured token", async () => {
    const bodies: string[] = [];
    const data = new Map([["x-refresh-token:100", ""]]);
    const api = new XApi(
      {
        userId: "100",
        username: "@theobot",
        clientId: "cid",
        clientSecret: "csec",
        refreshToken: "env",
        credentialStore: { get: async (k: string) => data.get(k), set: async () => {} },
        fetch: async (_u: string, init: { body?: string }) => {
          bodies.push(init.body ?? "");
          return { status: 200, text: async () => JSON.stringify({ access_token: "a" }) };
        },
      } as unknown as XAdapterOptions,
      () => 0,
    );
    await api.refresh();
    expect(new URLSearchParams(bodies[0]).get("refresh_token")).toBe("");
  });
});
