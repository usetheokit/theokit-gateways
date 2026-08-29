/**
 * Tests for GatewayRunner (T1.3, ADRs D170+ family + EC-A/D/E/F/G/H).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { SendResult } from "../../src/adapter/base.js";
import { GatewayLifecycleError } from "../../src/errors/lifecycle-error.js";
import type { PostOutboundContext } from "../../src/hooks/types.js";
import { GatewayRunner } from "../../src/runner/gateway-runner.js";
import type { MessageEvent } from "../../src/types/message-event.js";
import { MockAdapter } from "../adapter/mock-adapter.js";

function tg(text = "hi", chatId = 1): MessageEvent {
  return {
    id: `tg-${chatId}-${text.length}`,
    platform: "telegram",
    sender: { id: "100" },
    channel: { id: String(chatId), type: "dm" },
    text,
    receivedAt: 0,
    telegram: { chatId, messageId: 1, raw: {} },
  };
}

function dc(text = "hi"): MessageEvent {
  return {
    id: "dc-1",
    platform: "discord",
    sender: { id: "uA" },
    channel: { id: "cA", type: "dm" },
    text,
    receivedAt: 0,
    discord: { guildId: null, channelId: "cA", messageId: "m", raw: {} },
  };
}

describe("GatewayRunner (T1.3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("start connects all adapters", async () => {
    const a = new MockAdapter("telegram");
    const b = new MockAdapter("discord");
    const runner = new GatewayRunner({ adapters: [a, b], handler: async () => {} });
    await runner.start();
    expect(a.connected).toBe(true);
    expect(b.connected).toBe(true);
    await runner.stop();
  });

  it("inbound dispatches to handler", async () => {
    const a = new MockAdapter("telegram");
    let received: MessageEvent | undefined;
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async (event) => {
        received = event;
      },
    });
    await runner.start();
    await a.emit(tg());
    expect(received?.text).toBe("hi");
    await runner.stop();
  });

  it("handler throw does not crash runner", async () => {
    // Surviving the throw is half the contract; REPORTING it is the other half, and only the second
    // half was left unchecked. "test passes if we reach here" is satisfied just as well by a runner
    // that swallows the error in silence — the failure mode `rules/error-handling.md` § 5 names
    // first, and the one this suite would never have seen, because installing the spy is what makes
    // the log invisible in the first place.
    const writes: string[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((s) => {
      writes.push(String(s));
      return true;
    });
    const a = new MockAdapter("telegram");
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async () => {
        throw new Error("boom");
      },
    });
    await runner.start();
    await a.emit(tg());
    expect(a.connected).toBe(true);
    await runner.stop();
    stderr.mockRestore();

    const logged = writes.join("");
    expect(logged, "the handler throw was swallowed without a word").toContain("boom");
  });

  it("start() closes the adapters it already opened when another refuses", async () => {
    // Justified by absence, not by appetite for another test: mutation testing reported THREE
    // mutants with no coverage at all on this rollback, so the whole recovery path — the catch, the
    // disconnect of what was already open, the rethrow — was reachable by no test in the suite. A
    // broken rollback leaks a live platform connection on every failed start, and the process that
    // failed to start is exactly the one nobody is watching.
    const ok = new MockAdapter("telegram");
    const refuses = new MockAdapter("discord");
    refuses.connectResult = false;
    const runner = new GatewayRunner({ adapters: [ok, refuses], handler: async () => {} });

    await expect(runner.start()).rejects.toThrow(/discord/);
    expect(ok.connected, "the adapter that DID connect was left open").toBe(false);
    expect(ok.disconnectCount, "rollback did not disconnect it exactly once").toBe(1);
    // The refusal is a `false` return, not a throw, so nothing should have been rolled back on it.
    expect(refuses.disconnectCount).toBe(0);
  });

  it("stop disconnects all adapters", async () => {
    const a = new MockAdapter("telegram");
    const b = new MockAdapter("discord");
    const runner = new GatewayRunner({ adapters: [a, b], handler: async () => {} });
    await runner.start();
    await runner.stop();
    expect(a.connected).toBe(false);
    expect(b.connected).toBe(false);
  });

  it("stop is idempotent", async () => {
    const a = new MockAdapter("telegram");
    const runner = new GatewayRunner({ adapters: [a], handler: async () => {} });
    await runner.start();
    await runner.stop();
    await runner.stop();
    expect(a.disconnectCount).toBe(1);
  });

  it("start after stop refuses instead of resurrecting a runner nothing can stop", async () => {
    // stop() is terminal. It used to be one-way only for stop(): `connected` was
    // cleared, so a second start() sailed past its guard and reconnected, while
    // `stopped` was never cleared, so the next stop() returned before doing
    // anything. The adapter stayed connected, inbound dispatch stayed wired, and
    // nothing could take it down again (#39).
    const a = new MockAdapter("telegram");
    const runner = new GatewayRunner({ adapters: [a], handler: async () => {} });
    await runner.start();
    await runner.stop();

    await expect(runner.start()).rejects.toThrow(GatewayLifecycleError);
    expect(a.connectCount).toBe(1);
    expect(a.disconnectCount).toBe(1);
    expect(a.connected).toBe(false);
  });

  it("the refusal names the state it refused, not just that it failed", async () => {
    const a = new MockAdapter("telegram");
    const runner = new GatewayRunner({ adapters: [a], handler: async () => {} });
    await runner.start();
    await runner.stop();

    const err = await runner.start().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayLifecycleError);
    expect((err as GatewayLifecycleError).code).toBe("runner_stopped");
    expect((err as GatewayLifecycleError).message).toMatch(/stopped/i);
  });

  it("a stopped runner delivers no further inbound events", async () => {
    const a = new MockAdapter("telegram");
    let calls = 0;
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async () => {
        calls += 1;
      },
    });
    await runner.start();
    await runner.stop();
    await runner.start().catch(() => undefined);
    await a.emit(tg());

    expect(calls).toBe(0);
  });

  it("EC-G: ctx.reply routes to adapter matching event.platform", async () => {
    const tgA = new MockAdapter("telegram");
    const dcA = new MockAdapter("discord");
    const runner = new GatewayRunner({
      adapters: [tgA, dcA],
      handler: async (event, ctx) => {
        await ctx.reply(`got ${event.text}`);
      },
    });
    await runner.start();
    await tgA.emit(tg("ping"));
    await dcA.emit(dc("hello"));
    expect(tgA.sent.map((s) => s.text)).toEqual(["got ping"]);
    expect(dcA.sent.map((s) => s.text)).toEqual(["got hello"]);
    await runner.stop();
  });

  it("EC-D: block:true with message triggers reply then short-circuits", async () => {
    const a = new MockAdapter("telegram");
    let handlerCalled = false;
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async () => {
        handlerCalled = true;
      },
      hooks: [
        {
          name: "deny",
          pre_inbound: () => ({ block: true, message: "rate-limited" }),
        },
      ],
    });
    await runner.start();
    await a.emit(tg());
    expect(a.sent.map((s) => s.text)).toEqual(["rate-limited"]);
    expect(handlerCalled).toBe(false);
    await runner.stop();
  });

  it("EC-D negative: block:true without message short-circuits silently", async () => {
    const a = new MockAdapter("telegram");
    let handlerCalled = false;
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async () => {
        handlerCalled = true;
      },
      hooks: [{ name: "deny", pre_inbound: () => ({ block: true }) }],
    });
    await runner.start();
    await a.emit(tg());
    expect(a.sent).toHaveLength(0);
    expect(handlerCalled).toBe(false);
    await runner.stop();
  });

  it("post_outbound fires with the event, the outbound and the adapter's result", async () => {
    const a = new MockAdapter("telegram");
    const seen: PostOutboundContext[] = [];
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async (_event, ctx) => {
        await ctx.reply("pong", { format: "markdown" });
      },
      hooks: [
        {
          name: "audit",
          post_outbound: (ctx) => {
            seen.push(ctx);
          },
        },
      ],
    });
    await runner.start();
    await a.emit(tg("ping"));
    // `onInbound` resolves before dispatch completes (deliberately — see start()),
    // so the drain in stop() is the barrier that makes the assertion deterministic
    // rather than a bet on how many microtask ticks the chain happens to take.
    await runner.stop();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.event.text).toBe("ping");
    expect(seen[0]?.outbound).toMatchObject({
      channel: { id: "1", type: "dm" },
      text: "pong",
      format: "markdown",
    });
    expect(seen[0]?.result).toEqual({ ok: true, messageId: "mock-1" });
  });

  it("post_outbound fires on a failed send, so an audit hook sees the failure too", async () => {
    const a = new MockAdapter("telegram");
    a.failNextSend = { code: "rate_limited", message: "slow down" };
    const seen: PostOutboundContext[] = [];
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async (_event, ctx) => {
        await ctx.reply("pong");
      },
      hooks: [{ name: "audit", post_outbound: (ctx) => void seen.push(ctx) }],
    });
    await runner.start();
    await a.emit(tg());
    await runner.stop();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.result.ok).toBe(false);
    expect(seen[0]?.result.error?.code).toBe("rate_limited");
  });

  it("post_outbound observes the send without altering the result the handler receives", async () => {
    // Fire-and-forget means the hook watches the delivery; it does not intercept
    // it. A hook that throws must not turn a delivered reply into a failed one.
    const writes: string[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((s) => {
      writes.push(String(s));
      return true;
    });
    const a = new MockAdapter("telegram");
    let replyResult: SendResult | undefined;
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async (_event, ctx) => {
        replyResult = await ctx.reply("pong");
      },
      hooks: [
        {
          name: "broken-audit",
          post_outbound: () => {
            throw new Error("hook blew up");
          },
        },
      ],
    });
    await runner.start();
    await a.emit(tg());
    await runner.stop();

    expect(replyResult).toEqual({ ok: true, messageId: "mock-1" });
    stderr.mockRestore();

    // Not intercepting is not the same as not noticing. The reply assertion above holds equally for
    // a runner that drops the hook's failure on the floor, which would leave an audit hook broken
    // in production with nothing anywhere saying so.
    const logged = writes.join("");
    expect(logged, "the post_outbound hook failure was swallowed").toContain("broken-audit");
    expect(logged).toContain("hook blew up");
  });

  it("EC-D: the auto-reply on a blocking hook also fires post_outbound", async () => {
    const a = new MockAdapter("telegram");
    const seen: PostOutboundContext[] = [];
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async () => {},
      hooks: [
        { name: "deny", pre_inbound: () => ({ block: true, message: "rate-limited" }) },
        { name: "audit", post_outbound: (ctx) => void seen.push(ctx) },
      ],
    });
    await runner.start();
    await a.emit(tg());
    await runner.stop();

    expect(seen.map((c) => c.outbound.text)).toEqual(["rate-limited"]);
  });

  it("a reply with no adapter for the platform still reports the failure to post_outbound", async () => {
    // The runner answers `no_adapter` without ever reaching a transport. An audit
    // hook counting deliveries has to see that attempt too, or the count silently
    // omits exactly the replies that went nowhere.
    const tgA = new MockAdapter("telegram");
    const seen: PostOutboundContext[] = [];
    const runner = new GatewayRunner({
      adapters: [tgA],
      handler: async (_event, ctx) => {
        await ctx.reply("pong");
      },
      hooks: [{ name: "audit", post_outbound: (ctx) => void seen.push(ctx) }],
    });
    await runner.start();
    // Emitted through the telegram adapter but carrying a discord event: the
    // runner routes by `event.platform`, which no registered adapter serves.
    await tgA.emit(dc("ping"));
    await runner.stop();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.result.error?.code).toBe("no_adapter");
  });

  it("EC-E: stop drains in-flight handlers before disconnect", async () => {
    const a = new MockAdapter("telegram");
    let handlerDone = false;
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async () => {
        await new Promise((r) => setTimeout(r, 50));
        handlerDone = true;
      },
    });
    await runner.start();
    const inflight = a.emit(tg());
    // Initiate stop while handler is mid-flight.
    const stopP = runner.stop();
    await Promise.all([inflight, stopP]);
    expect(handlerDone).toBe(true);
  });

  it("EC-E: stop force-disconnects after drain timeout", async () => {
    const a = new MockAdapter("telegram");
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async () => {
        // Hang past the drain timeout.
        await new Promise((r) => setTimeout(r, 500));
      },
      drainTimeoutMs: 50,
    });
    await runner.start();
    // Emit but don't await — handler will hang for 500ms.
    void a.emit(tg());
    const t0 = Date.now();
    await runner.stop();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(300);
    expect(a.connected).toBe(false);
  });

  it("stop leaves no pending drain timer once the drain wins the race", async () => {
    // A timer that outlives `stop()` keeps Node's event loop alive, so a bot that
    // stops on SIGINT hangs for the whole drainTimeoutMs before the process exits.
    // Counting timers is what distinguishes "stop() returned" from "stop() cleaned
    // up" — the two looked identical until the process refused to exit (#37).
    vi.useFakeTimers();
    try {
      const a = new MockAdapter("telegram");
      let release: (() => void) | undefined;
      const held = new Promise<void>((r) => {
        release = r;
      });
      const runner = new GatewayRunner({
        adapters: [a],
        handler: async () => {
          await held;
        },
      });
      await runner.start();
      // Not awaited: the handler must still be in flight when stop() runs, which
      // is the only branch that arms the drain timer.
      void a.emit(tg());
      const stopP = runner.stop();
      release?.();
      await stopP;

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("EC-F: handler error logs are redacted", async () => {
    const writes: string[] = [];
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((s: string | Uint8Array) => {
        writes.push(typeof s === "string" ? s : Buffer.from(s).toString("utf8"));
        return true;
      });
    const a = new MockAdapter("telegram");
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async () => {
        // Include something that looks like a token.
        throw new Error("auth failed bearer sk-abc123def456ghi789jkl");
      },
    });
    await runner.start();
    await a.emit(tg());
    await runner.stop();
    const combined = writes.join("");
    expect(combined).toContain("handler error");
    // The literal token string should NOT appear unredacted.
    expect(combined).not.toContain("sk-abc123def456ghi789jkl");
    stderr.mockRestore();
  });

  it("EC-A: /skill does not shadow /skills (word-boundary match)", async () => {
    const a = new MockAdapter("telegram");
    const calls: string[] = [];
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async () => {
        calls.push("default");
      },
    });
    runner.command("skill", async () => {
      calls.push("/skill");
    });
    runner.command("skills", async () => {
      calls.push("/skills");
    });
    await runner.start();
    await a.emit(tg("/skills"));
    await a.emit(tg("/skill foo"));
    await a.emit(tg("/skill"));
    expect(calls).toEqual(["/skills", "/skill", "/skill"]);
    await runner.stop();
  });

  it("EC-A: slash command with @botname suffix matches", async () => {
    const a = new MockAdapter("telegram");
    const calls: string[] = [];
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async () => {},
    });
    runner.command("help", async () => {
      calls.push("/help");
    });
    await runner.start();
    await a.emit(tg("/help@theo_paulo_bot"));
    expect(calls).toEqual(["/help"]);
    await runner.stop();
  });
});
