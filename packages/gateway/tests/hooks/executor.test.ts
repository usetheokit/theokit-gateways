/**
 * Tests for HookExecutor (T4.1, ADRs D176/D177).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { GatewayConfigurationError } from "../../src/errors/config-error.js";
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
    // A PERMISSIVE hook runs first, and that ordering is the point. Every hook in this suite either
    // blocked or was short-circuited before it ran, so no test ever observed a hook that executes,
    // returns nothing, and lets the chain continue — the ordinary case. Without it, treating every
    // decision as a block is undetectable: the first hook stops the chain, the assertions below still
    // see block === true, and a gateway that refuses every request looks exactly like a healthy one.
    const hooks: GatewayHook[] = [
      {
        name: "allows",
        pre_inbound: () => {
          calls.push("allows");
        },
      },
      {
        // Returning nothing and returning `{ block: false }` are BOTH "allow", and only the second
        // distinguishes "this decision blocks" from "there is a decision". Without it, short-circuiting
        // on the mere presence of a returned object is invisible: the implicit-allow hook above returns
        // undefined and passes through under either reading.
        name: "allows-explicitly",
        pre_inbound: () => {
          calls.push("allows-explicitly");
          return { block: false };
        },
      },
      {
        name: "denies",
        pre_inbound: () => {
          calls.push("denies");
          return { block: true, message: "no" };
        },
      },
      {
        name: "never",
        pre_inbound: () => {
          calls.push("never");
        },
      },
    ];
    const d = await new HookExecutor(hooks).firePreInbound({ event: ev });
    expect(d.block).toBe(true);
    expect(d.message).toBe("no");
    // "allows" ran and did NOT stop the chain; "never" is after the block and must not have run.
    expect(calls).toEqual(["allows", "allows-explicitly", "denies"]);
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
      // Implements a DIFFERENT phase. Without one of these the `=== undefined` skip is never
      // observed: calling a missing hook throws a TypeError that the catch below swallows, so the
      // suite stays green while every hook in the list is invoked. It declares `on_error` rather
      // than nothing at all because nothing at all is now refused at construction (#80) — and a
      // hook that implements one phase and not another is the realistic shape anyway.
      { name: "silent", on_error: () => undefined },
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

    // The spy was installed and never read, which silenced the log instead of checking it. What the
    // catch owes the operator is a message naming the hook that failed — a catch that writes nothing
    // is the silent-error anti-pattern `rules/error-handling.md` forbids.
    const logged = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(logged, "the throwing hook was swallowed silently").toContain("first");
    expect(logged).toContain("ouch");
    // Exactly one complaint: the hook that declared nothing must be skipped, not called and caught.
    expect(logged, "a hook without post_outbound was invoked anyway").not.toContain("silent");

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
      // Declares no on_error — it implements `pre_inbound` instead. Pins that the `=== undefined`
      // skip is a skip, and not a call whose TypeError the catch quietly absorbs.
      { name: "silent", pre_inbound: () => undefined },
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
    expect(logged, "a hook without on_error was invoked anyway").not.toContain("silent");
  });
});

describe("HookExecutor — hook validation at the boundary (#80)", () => {
  // A hook list is caller input arriving at a system boundary, and `rules/error-handling.md` § 2
  // says validate it there. Before this, every phase asked `if (h.<phase> === undefined) continue`,
  // which reads "this hook does not implement this phase" and "this is not a hook" identically —
  // so a config-driven list with an entry that failed to resolve started a gateway whose rate
  // limiter, audit trail or error reporter was simply absent, with nothing said. A silently missing
  // security hook is worse than a loud failure: the deployment looks correct.
  // Third column: the fragment that says WHY. All eight share one `code`, so unlike the sibling
  // adapters the code cannot discriminate and the message is the only thing that does — "is null,
  // not a hook object" and "has no name" send an operator to different fixes. A fragment rather
  // than the whole string, so rewording the surrounding prose does not break eight tests.
  const rejected: ReadonlyArray<readonly [string, unknown, string]> = [
    ["undefined", undefined, "is undefined, not a hook object"],
    ["null", null, "is null, not a hook object"],
    ["a string", "pre_inbound", "is string, not a hook object"],
    ["a number", 7, "is number, not a hook object"],
    ["an object with no name", { pre_inbound: () => undefined }, "has no name"],
    ["an object whose name is empty", { name: "", pre_inbound: () => undefined }, "has no name"],
    [
      "an object declaring no phase at all",
      { name: "inert" },
      "declares none of pre_inbound, post_outbound, on_error",
    ],
    [
      "an object whose phase is not callable",
      { name: "bad", pre_inbound: "nope" },
      "declares pre_inbound, which is not callable",
    ],
  ];

  it.each(rejected)("refuses %s, naming where it was and why", (_what, entry, why) => {
    let thrown: unknown;
    try {
      new HookExecutor([{ name: "fine", on_error: () => undefined }, entry] as never);
    } catch (err) {
      thrown = err;
    }
    expect(thrown, "a malformed hook was accepted in silence").toBeInstanceOf(
      GatewayConfigurationError,
    );
    const err = thrown as GatewayConfigurationError;
    // The index is half the diagnostic: a list built from config has no other way to say WHICH
    // entry is wrong, and "one of your hooks is malformed" sends the reader back to guess.
    expect(err.message, "the refusal does not say which entry").toContain("hooks[1]");
    expect(err.message, "the refusal does not say what is wrong with it").toContain(why);
    expect(err.code).toBe("malformed_hook");
    // `detail` is part of the published error shape, so a caller can branch on the position
    // without parsing prose.
    expect(err.detail, "detail does not carry the position").toBe("hooks[1]");
  });

  it("accepts a hook that implements only one of the three phases", () => {
    // The guard against a fix that overshoots. Every phase is optional by contract, so a hook
    // declaring exactly one is the ORDINARY case — most of this file's own hooks are that shape —
    // and a validator demanding all three would refuse nearly every real hook.
    expect(() => new HookExecutor([{ name: "a", pre_inbound: () => undefined }])).not.toThrow();
    expect(() => new HookExecutor([{ name: "b", post_outbound: () => undefined }])).not.toThrow();
    expect(() => new HookExecutor([{ name: "c", on_error: () => undefined }])).not.toThrow();
    expect(() => new HookExecutor([]), "an empty list is a valid list").not.toThrow();
  });
});
