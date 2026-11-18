import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFilePairingStore, senderKey } from "../../src/index.js";

const dir = () => mkdtempSync(join(tmpdir(), "pair-"));

describe("pairing store", () => {
  it("issues a stable 6-digit code and persists approval with mode 0600", async () => {
    const d = dir();
    const s = createFilePairingStore({ dir: d });
    const c = s.issue("telegram", "1");
    expect(c).toMatch(/^\d{6}$/);
    expect(s.issue("telegram", "1")).toBe(c);
    expect(s.isPaired("telegram", "1")).toBe(false);
    expect(await s.approve(c)).toEqual({ ok: true, platform: "telegram", senderId: "1" });
    expect(s.isPaired("telegram", "1")).toBe(true);
    expect(statSync(join(d, "pairing.json")).mode & 0o777).toBe(0o600);
    expect(createFilePairingStore({ dir: d }).isPaired("telegram", "1")).toBe(true);
  });
  it("does not reuse a pre-existing temp file's permissions", async () => {
    const d = dir();
    writeFileSync(join(d, `pairing.json.${process.pid}.5.tmp`), "x", { mode: 0o644 });
    const s = createFilePairingStore({ dir: d, random: () => 5 });
    const c = s.issue("a", "1");
    await s.approve(c);
    expect(statSync(join(d, "pairing.json")).mode & 0o777).toBe(0o600);
  });
  it("rejects unknown and expired codes", async () => {
    let t = 0;
    const s = createFilePairingStore({ dir: dir(), clock: () => t });
    const c = s.issue("a", "1");
    expect(await s.approve("000000")).toEqual({ ok: false, reason: "unknown_or_expired" });
    t = 3_600_001;
    expect(await s.approve(c)).toEqual({ ok: false, reason: "unknown_or_expired" });
  });
  it("never gives two senders the same code", () => {
    const seq = [123456, 123456, 654321];
    const s = createFilePairingStore({ dir: dir(), random: () => seq.shift() ?? 111111 });
    expect(s.issue("a", "1")).toBe("123456");
    expect(s.issue("a", "2")).toBe("654321");
  });
  it("treats a missing file as empty and a malformed one as an error", () => {
    const d = dir();
    expect(createFilePairingStore({ dir: d }).isPaired("a", "1")).toBe(false);
    writeFileSync(join(d, "pairing.json"), "{nope");
    expect(() => createFilePairingStore({ dir: d })).toThrow(
      expect.objectContaining({ code: "pairing_store_unreadable" }),
    );
    writeFileSync(join(d, "pairing.json"), '{"paired":[1]}');
    expect(() => createFilePairingStore({ dir: d })).toThrow(
      expect.objectContaining({ code: "pairing_store_unreadable" }),
    );
  });
  it("persists two concurrent approvals", async () => {
    const d = dir();
    const s = createFilePairingStore({ dir: d });
    const a = s.issue("a", "1");
    const b = s.issue("a", "2");
    await Promise.all([s.approve(a), s.approve(b)]);
    const file = JSON.parse(readFileSync(join(d, "pairing.json"), "utf8"));
    expect(file.paired).toEqual(["a:1", "a:2"]);
  });
  it("lowercases email ids only", () => {
    expect(senderKey("email", "A@B.com")).toBe("email:a@b.com");
    expect(senderKey("slack", "U1A")).toBe("slack:U1A");
  });
});
