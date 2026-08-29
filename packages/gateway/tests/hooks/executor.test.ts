/**
 * Tests for HookExecutor (T4.1, ADRs D176/D177).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { HookExecutor } from "../../src/hooks/executor.js";
import type { GatewayHook } from "../../src/hooks/types.js";
import type { MessageEvent } from "../../src/types/message-event.js";

const ev: MessageEvent = {
  id: "1",
  platform: "telegram",
  sender: { id: "u" },
  channel: { id: "c", type: "dm" },
  text: "hi",
  receivedAt: 0,
  telegram: { chatId: 1, messageId: 1, raw: {} },
};

describe("HookExecutor (T4.1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("empty hooks returns unblocked", async () => {
    const ex = new HookExecutor([]);
    const d = await ex.firePreInbound({ event: ev });
    expect(d.block).toBe(false);
  });

  it("first block short-circuits the chain", async () => {
    const calls: string[] = [];
    const hooks: GatewayHook[] = [
      {
        name: "first",
        pre_inbound: () => {
          calls.push("first");
          return { block: true, message: "no" };
        },
      },
      {
        name: "second",
        pre_inbound: () => {
          calls.push("second");
        },
      },
    ];
    const d = await new HookExecutor(hooks).firePreInbound({ event: ev });
    expect(d.block).toBe(true);
    expect(d.message).toBe("no");
    expect(calls).toEqual(["first"]);
  });

  it("hook throw is treated as block", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const hooks: GatewayHook[] = [
      {
        name: "bad",
        pre_inbound: () => {
          throw new Error("boom");
        },
      },
    ];
    const d = await new HookExecutor(hooks).firePreInbound({ event: ev });
    expect(d.block).toBe(true);
    // Names the hook, so the operator can find it. This used to assert
    // `toContain("boom")` — see the leak test below for why that was a bug and
    // not a feature.
    expect(d.message).toContain("bad");
    stderr.mockRestore();
  });

  it("does not put the raw exception text into the user-facing block message", async () => {
    // `GatewayRunner.dispatch` replies with `decision.message` straight into the
    // chat. So whatever a throwing hook's `err.message` happened to contain went
    // to the end user verbatim: connection strings, internal ids, bearer tokens.
    //
    // The sibling path already knew better — `gateway-runner.test.ts` asserts a
    // handler throw is logged through `Security.redact` (EC-F). The hook path
    // skipped redaction entirely, and `expect(d.message).toContain("boom")`
    // locked the leak in as the expected behaviour.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const secret = "bearer sk-abc123def456ghi789jkl";
    const hooks: GatewayHook[] = [
      {
        name: "auth-check",
        pre_inbound: () => {
          throw new Error(`auth failed ${secret}`);
        },
      },
    ];

    const d = await new HookExecutor(hooks).firePreInbound({ event: ev });

    expect(d.block).toBe(true);
    expect(d.message).not.toContain("sk-abc123def456ghi789jkl");
    expect(d.message).not.toContain("auth failed");
    stderr.mockRestore();
  });

  it("logs the failure detail to stderr, redacted, so it is still diagnosable", async () => {
    // Sanitizing the user-facing reply must not mean losing the error. The
    // detail moves to stderr, through the same redactor the handler path uses.
    const writes: string[] = [];
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((s: string | Uint8Array) => {
        writes.push(typeof s === "string" ? s : Buffer.from(s).toString("utf8"));
        return true;
      });
    const hooks: GatewayHook[] = [
      {
        name: "auth-check",
        pre_inbound: () => {
          throw new Error("auth failed bearer sk-abc123def456ghi789jkl");
        },
      },
    ];

    await new HookExecutor(hooks).firePreInbound({ event: ev });

    const combined = writes.join("");
    expect(combined).toContain("auth-check");
    expect(combined).toContain("pre_inbound");
    expect(combined).not.toContain("sk-abc123def456ghi789jkl");
    stderr.mockRestore();
  });

  it("still passes through a message the hook itself chose to return", async () => {
    // Only the THROW path is sanitized. A hook that deliberately blocks with
    // text meant for the user must keep saying exactly that — this is the EC-D
    // auto-reply contract.
    const hooks: GatewayHook[] = [
      { name: "policy", pre_inbound: () => ({ block: true, message: "Not allowed here." }) },
    ];
    const d = await new HookExecutor(hooks).firePreInbound({ event: ev });
    expect(d.message).toBe("Not allowed here.");
  });

  it("undefined decision is treated as continue", async () => {
    const hooks: GatewayHook[] = [{ name: "neutral", pre_inbound: () => undefined }];
    const d = await new HookExecutor(hooks).firePreInbound({ event: ev });
    expect(d.block).toBe(false);
  });

  it("post_outbound fires all hooks even when one throws", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const calls: string[] = [];
    const hooks: GatewayHook[] = [
      {
        name: "first",
        post_outbound: () => {
          calls.push("first");
          throw new Error("ouch");
        },
      },
      {
        name: "second",
        post_outbound: () => {
          calls.push("second");
        },
      },
    ];
    await new HookExecutor(hooks).firePostOutbound({
      event: ev,
      outbound: { channel: ev.channel, text: "x" },
      result: { ok: true },
    });
    expect(calls).toEqual(["first", "second"]);
    stderr.mockRestore();
  });

  it("on_error fires every hook even when one of them throws, and says which", async () => {
    // The first hook throws on purpose. `fireOnError` runs while something has ALREADY failed, so a
    // hook that fails in there must not take the remaining hooks with it — and must not disappear
    // either. Until this, both hooks succeeded and the catch was never entered at all: mutation
    // testing reported its three mutants as NoCoverage, meaning the whole recovery path could be
    // deleted with every test still green.
    const calls: string[] = [];
    const written: string[] = [];
    const restore = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    const hooks: GatewayHook[] = [
      {
        name: "a",
        on_error: () => {
          calls.push("a");
          throw new Error("hook a is broken");
        },
      },
      {
        name: "b",
        on_error: () => {
          calls.push("b");
        },
      },
    ];

    try {
      // Must not reject: a throw escaping here would replace the original failure with this one.
      await expect(
        new HookExecutor(hooks).fireOnError({ event: ev, error: new Error("x") }),
      ).resolves.toBeUndefined();
    } finally {
      process.stderr.write = restore;
    }

    // "b" ran despite "a" throwing — the loop continued rather than aborting.
    expect(calls, "a throwing stopped the remaining hooks").toEqual(["a", "b"]);

    // And the swallow is reported. A catch that logs nothing is the silent-error anti-pattern
    // `rules/error-handling.md` forbids, and it is what the emptied-catch mutant produces.
    const logged = written.join("");
    expect(logged, "the failing hook was swallowed silently").toContain("a");
    expect(logged).toContain("hook a is broken");
  });
});
