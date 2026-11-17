import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HookExecutor } from "../../src/hooks/executor.js";
import {
  createAccessPolicyHook,
  createFilePairingStore,
  type DmPolicy,
  type PairingStore,
} from "../../src/index.js";

const ev = (platform: string, id: string, text = "hi", type = "dm") =>
  ({ platform, sender: { id }, channel: { id: "c", type }, text }) as never;
const auth = (p: string) => p !== "email" && p !== "sms";
const store = () => createFilePairingStore({ dir: mkdtempSync(join(tmpdir(), "ap-")) });
const base = { owners: new Set(["telegram:1"]), isAuthenticated: auth as never };

describe("access policy", () => {
  it("runs the pairing flow", async () => {
    let t = 0;
    const hook = createAccessPolicyHook({
      ...base,
      dm: "pairing",
      pairing: store(),
      clock: () => t,
      refusalIntervalMs: 1000,
    });
    const run = (e: never) => hook.pre_inbound?.({ event: e });
    expect(await run(ev("telegram", "1"))).toBeUndefined();
    const r = (await run(ev("telegram", "2"))) as { block: boolean; message: string };
    const code = /\d{6}/.exec(r.message)?.[0] as string;
    expect(code).toBeTruthy();
    expect(await run(ev("telegram", "2"))).toEqual({ block: true });
    t = 1000;
    expect(((await run(ev("telegram", "2"))) as { message: string }).message).toContain(code);
    expect(await run(ev("telegram", "1", `/approve ${code}`))).toEqual({
      block: true,
      message: "Paired.",
    });
    expect(await run(ev("telegram", "2"))).toBeUndefined();
  });
  it("does not let a stranger approve", async () => {
    const hook = createAccessPolicyHook({ ...base, dm: "pairing", pairing: store() });
    const r = await hook.pre_inbound?.({ event: ev("telegram", "2", "/approve 123456") });
    expect((r as { message: string }).message).toContain("pairing code");
  });
  it.each(["pairing", "allowlist", "open", "disabled"] as DmPolicy[])(
    "never answers an unauthenticated stranger (%s)",
    async (dm) => {
      const hook = createAccessPolicyHook({ ...base, dm, pairing: store() });
      const r = await hook.pre_inbound?.({ event: ev("sms", "9") });
      expect((r as { message?: string } | undefined)?.message).toBeUndefined();
    },
  );
  it("answers the allowlist refusal text", async () => {
    const hook = createAccessPolicyHook({ ...base, dm: "allowlist", refusalText: "no" });
    expect(await hook.pre_inbound?.({ event: ev("telegram", "2") })).toEqual({
      block: true,
      message: "no",
    });
  });
  it("handles groups", async () => {
    const silent = createAccessPolicyHook({ ...base, dm: "open" });
    expect(await silent.pre_inbound?.({ event: ev("telegram", "2", "x", "group") })).toEqual({
      block: true,
    });
    const open = createAccessPolicyHook({ ...base, dm: "open", groups: "open" });
    expect(await open.pre_inbound?.({ event: ev("telegram", "2", "x", "group") })).toBeUndefined();
  });
  it("silently blocks and logs once when the store throws", async () => {
    const bad: PairingStore = {
      issue() {
        throw new Error("boom sk-abcdefghijklmnopqrstuvwxyz123456");
      },
      approve: async () => ({ ok: false, reason: "write_failed" }),
      isPaired: () => false,
    };
    const lines: string[] = [];
    const hook = createAccessPolicyHook({
      ...base,
      dm: "pairing",
      pairing: bad,
      write: (l) => lines.push(l),
    });
    expect(await hook.pre_inbound?.({ event: ev("telegram", "2") })).toEqual({ block: true });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
  });
  it("sends no reply to an unauthenticated DM under dm open, through the executor", async () => {
    const hook = createAccessPolicyHook({ ...base, dm: "open" });
    const d = await new HookExecutor([hook]).firePreInbound({ event: ev("sms", "9") });
    expect(d.block).toBe(true);
    expect(d.message).toBeUndefined();
  });
  it("keeps the silent block when the write callback throws", async () => {
    const bad: PairingStore = {
      issue() {
        throw new Error("boom");
      },
      approve: async () => ({ ok: false, reason: "write_failed" }),
      isPaired: () => false,
    };
    const hook = createAccessPolicyHook({
      ...base,
      dm: "pairing",
      pairing: bad,
      write: () => {
        throw new Error("writer down");
      },
    });
    const d = await new HookExecutor([hook]).firePreInbound({ event: ev("telegram", "2") });
    expect(d.block).toBe(true);
    expect(d.message).toBeUndefined();
  });
  it("matches email owners case-insensitively only when email is authenticated", async () => {
    const hook = createAccessPolicyHook({
      owners: new Set(["email:Boss@Example.com"]),
      dm: "disabled",
      isAuthenticated: () => true,
    });
    expect(await hook.pre_inbound?.({ event: ev("email", "boss@example.com") })).toBeUndefined();
    try {
      createAccessPolicyHook({
        owners: new Set(["email:Boss@Example.com"]),
        dm: "disabled",
        isAuthenticated: auth as never,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as { code: string }).code).toBe("unauthenticated_owner");
      expect((e as Error).message).not.toContain("Boss");
    }
  });
  it("requires a store for pairing and honours passThrough", async () => {
    expect(() => createAccessPolicyHook({ ...base, dm: "pairing" })).toThrow();
    const hook = createAccessPolicyHook({ ...base, dm: "disabled", passThrough: () => true });
    expect(await hook.pre_inbound?.({ event: ev("telegram", "2") })).toBeUndefined();
  });
});
