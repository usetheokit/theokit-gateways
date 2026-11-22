import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { safeEqualString, verifyDigest, verifyHmac } from "../src/index.js";

const hmac = (
  alg: "sha256" | "sha1",
  key: string,
  msg: string,
  enc: "hex" | "base64" | "base64url",
) => createHmac(alg, key).update(msg).digest(enc);

describe("verifyHmac adapter vectors", () => {
  it("LINE base64", () => {
    const sig = hmac("sha256", "s", "body", "base64");
    expect(
      verifyHmac({
        algorithm: "sha256",
        secrets: "s",
        message: "body",
        signature: sig,
        encoding: "base64",
      }),
    ).toBe(true);
    expect(
      verifyHmac({
        algorithm: "sha256",
        secrets: "s",
        message: "bodY",
        signature: sig,
        encoding: "base64",
      }),
    ).toBe(false);
  });
  it("WhatsApp sha256= hex, bytes message", () => {
    const sig = `sha256=${hmac("sha256", "s", "body", "hex")}`;
    const o = {
      algorithm: "sha256",
      secrets: "s",
      message: new TextEncoder().encode("body"),
      encoding: "hex",
      prefix: "sha256=",
    } as const;
    expect(verifyHmac({ ...o, signature: sig })).toBe(true);
    expect(verifyHmac({ ...o, signature: sig.slice(7) })).toBe(false);
    expect(verifyHmac({ ...o, signature: `sha1=${sig.slice(7)}` })).toBe(false);
  });
  it("Nextcloud Talk upper-case hex", () => {
    const sig = hmac("sha256", "s", "randbody", "hex").toUpperCase();
    const o = {
      algorithm: "sha256",
      secrets: "s",
      message: "randbody",
      encoding: "hex",
      signature: sig,
    } as const;
    expect(verifyHmac({ ...o, caseInsensitive: true })).toBe(true);
    expect(verifyHmac(o)).toBe(false);
  });
  it("Yuanbao timestamp.body", () => {
    const sig = hmac("sha256", "s", "123.body", "hex");
    expect(
      verifyHmac({
        algorithm: "sha256",
        secrets: "s",
        message: "123.body",
        signature: sig,
        encoding: "hex",
      }),
    ).toBe(true);
  });
  it("base64url", () => {
    const sig = hmac("sha1", "s", "m", "base64url");
    expect(
      verifyHmac({
        algorithm: "sha1",
        secrets: "s",
        message: "m",
        signature: sig,
        encoding: "base64url",
      }),
    ).toBe(true);
  });
  it("rotation", () => {
    const o = {
      algorithm: "sha256",
      secrets: ["old", "new"],
      message: "m",
      encoding: "hex",
    } as const;
    expect(verifyHmac({ ...o, signature: hmac("sha256", "old", "m", "hex") })).toBe(true);
    expect(verifyHmac({ ...o, signature: hmac("sha256", "new", "m", "hex") })).toBe(true);
    expect(verifyHmac({ ...o, signature: hmac("sha256", "third", "m", "hex") })).toBe(false);
  });
  it("negatives never throw", () => {
    const o = {
      algorithm: "sha256",
      secrets: "s",
      message: "m",
      encoding: "hex",
      prefix: "sha256=",
    } as const;
    const good = hmac("sha256", "s", "m", "hex");
    for (const signature of [
      undefined,
      "",
      "sha256=",
      `sha256=${good.slice(2)}`,
      `sha256=${"z".repeat(64)}`,
      good,
    ]) {
      expect(verifyHmac({ ...o, signature })).toBe(false);
    }
  });
  it("empty secrets throw RangeError naming secrets", () => {
    for (const secrets of ["", [], ["a", ""]]) {
      expect(() =>
        verifyHmac({ algorithm: "sha256", secrets, message: "m", signature: "x", encoding: "hex" }),
      ).toThrow(/secrets/);
      expect(() =>
        verifyHmac({ algorithm: "sha256", secrets, message: "m", signature: "x", encoding: "hex" }),
      ).toThrow(RangeError);
    }
  });
});

describe("verifyDigest", () => {
  it("Zalo mac= sha256", () => {
    const sig = `mac=${createHash("sha256").update("a1b2").digest("hex")}`;
    const o = { algorithm: "sha256", message: "a1b2", encoding: "hex", prefix: "mac=" } as const;
    expect(verifyDigest({ ...o, signature: sig })).toBe(true);
    expect(verifyDigest({ ...o, signature: sig.slice(4) })).toBe(false);
  });
  it("WeChat/WeCom sorted sha1", () => {
    const message = ["tok", "ts", "nonce"].sort().join("");
    const sig = createHash("sha1").update(message).digest("hex");
    expect(verifyDigest({ algorithm: "sha1", message, signature: sig, encoding: "hex" })).toBe(
      true,
    );
    expect(
      verifyDigest({ algorithm: "sha1", message, signature: undefined, encoding: "hex" }),
    ).toBe(false);
    expect(verifyDigest({ algorithm: "sha1", message, signature: "", encoding: "hex" })).toBe(
      false,
    );
    expect(verifyDigest({ algorithm: "sha1", message, signature: "zz", encoding: "hex" })).toBe(
      false,
    );
  });
});

describe("safeEqualString", () => {
  it("compares", () => {
    expect(safeEqualString("abc", "abc")).toBe(true);
    expect(safeEqualString("abc", "abd")).toBe(false);
    expect(safeEqualString("abc", "ab")).toBe(false);
    expect(safeEqualString("", "")).toBe(false);
    expect(safeEqualString("a", "")).toBe(false);
  });
});
