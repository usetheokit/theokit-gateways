import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decodeJwt, jwksKeySet, verifyRs256Jwt } from "../../src/index.js";

const b64 = (v: unknown) =>
  Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = (kid: string) => ({ ...pair.publicKey.export({ format: "jwk" }), kid, use: "sig" });

function token(header: Record<string, unknown>, payload: Record<string, unknown> = { sub: "a" }) {
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), pair.privateKey).toString("base64url")}`;
}

function setup(kids = ["k1"], maxAge = 3600) {
  let t = 0;
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ keys: kids.map(jwk) }), {
        headers: { "cache-control": `public, max-age=${maxAge}` },
      }),
  );
  const keys = jwksKeySet({ url: "https://x/jwks", fetch, now: () => t });
  return {
    fetch,
    keys,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("verifyRs256Jwt", () => {
  it("verifies a listed kid and rejects a changed payload", async () => {
    const { keys } = setup();
    const tok = token({ alg: "RS256", kid: "k1" });
    const ok = await verifyRs256Jwt(tok, keys);
    expect(ok).toMatchObject({ ok: true, payload: { sub: "a" } });
    const [h, , s] = tok.split(".");
    const tampered = `${h}.${b64({ sub: "b" })}.${s}`;
    expect(await verifyRs256Jwt(tampered, keys)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("answers unknown_kid, unsupported_alg and malformed", async () => {
    const { keys } = setup();
    expect(await verifyRs256Jwt(token({ alg: "RS256", kid: "zz" }), keys)).toEqual({
      ok: false,
      reason: "unknown_kid",
    });
    for (const alg of ["none", "HS256"]) {
      expect(await verifyRs256Jwt(token({ alg, kid: "k1" }), keys)).toEqual({
        ok: false,
        reason: "unsupported_alg",
      });
    }
    expect(await verifyRs256Jwt("a.b", keys)).toEqual({ ok: false, reason: "malformed" });
    expect(decodeJwt("a.b")).toBeUndefined();
  });

  it("answers keys_unavailable when a cold fetch rejects", async () => {
    const keys = jwksKeySet({ url: "u", fetch: async () => Promise.reject(new Error("down")) });
    expect(await verifyRs256Jwt(token({ alg: "RS256", kid: "k1" }), keys)).toEqual({
      ok: false,
      reason: "keys_unavailable",
    });
  });
});

describe("jwksKeySet", () => {
  it("shares one fetch between concurrent cold lookups", async () => {
    const { keys, fetch } = setup();
    await Promise.all([keys.lookup("k1"), keys.lookup("k1")]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refetches once for an unknown kid, then not within the floor", async () => {
    const { keys, fetch, advance } = setup();
    await keys.lookup("k1");
    advance(61_000);
    expect(await keys.lookup("a")).toBe("unlisted");
    expect(fetch).toHaveBeenCalledTimes(2);
    advance(1_000);
    expect(await keys.lookup("b")).toBe("unlisted");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("serves a stale key and refreshes in the background", async () => {
    const { keys, fetch, advance } = setup(["k1"], 60);
    await keys.lookup("k1");
    advance(61_000);
    const found = await keys.lookup("k1");
    expect(typeof found).toBe("object");
    expect(fetch).toHaveBeenCalledTimes(2);
    await keys.lookup("k1");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
