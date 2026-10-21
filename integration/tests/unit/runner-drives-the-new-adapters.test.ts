/**
 * `GatewayRunner` over each new adapter, offline (FR-008, AC-008).
 *
 * The gateway half of "the app replies on <platform>": one inbound message goes through the
 * runner, the handler replies through `ctx.reply`, and exactly one platform call carries the reply
 * while `post_outbound` fires exactly once for the member's key. A reply written straight to the
 * adapter, around the runner, reaches the platform and leaves `post_outbound` at zero: the hook
 * observes the runner, not the transport.
 *
 * Every transport here is scripted in this file and handed to the adapter through its own public
 * seam, so nothing spawns a process, opens a remote socket or calls a real endpoint.
 */

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import {
  type BasePlatformAdapter,
  type GatewayHook,
  GatewayRunner,
  type PlatformName,
} from "@theokit/gateway";
import { type ChildLike, SignalAdapter } from "@theokit/gateway-signal";
import { afterEach, describe, expect, it } from "vitest";

/** One new platform, its adapter over a scripted transport, and what the transport saw. */
interface Member {
  readonly key: PlatformName;
  readonly adapter: BasePlatformAdapter;
  /** Feed one inbound text message to the adapter, as the platform would. */
  inject(text: string): Promise<void>;
  /** The texts the transport was asked to send, in order. */
  sent(): readonly string[];
  /** Release anything the transport holds open. */
  close(): Promise<void>;
}

/** A signal-cli child that answers `listGroups` and every `send`, and can push a `receive`. */
class ScriptedSignalCli extends EventEmitter implements ChildLike {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly sends: string[] = [];
  private buffered = "";

  constructor() {
    super();
    this.stdin.on("data", (chunk: Buffer) => {
      this.buffered += chunk.toString("utf8");
      for (let at = this.buffered.indexOf("\n"); at !== -1; at = this.buffered.indexOf("\n")) {
        this.onRequest(this.buffered.slice(0, at));
        this.buffered = this.buffered.slice(at + 1);
      }
    });
  }

  receive(text: string): void {
    const envelope = {
      sourceNumber: "+5511988887777",
      sourceUuid: "uuid-peer",
      timestamp: Date.now(),
      dataMessage: { timestamp: Date.now(), message: text },
    };
    this.line({ jsonrpc: "2.0", method: "receive", params: { envelope } });
  }

  kill(): boolean {
    queueMicrotask(() => {
      this.stdout.end();
      this.emit("close", null, "SIGTERM");
    });
    return true;
  }

  private onRequest(raw: string): void {
    const request = JSON.parse(raw) as { id: number; method: string; params: { message?: string } };
    if (request.method === "send") this.sends.push(request.params.message ?? "");
    const result = request.method === "send" ? { timestamp: this.sends.length } : [];
    this.line({ jsonrpc: "2.0", id: request.id, result });
  }

  private line(message: unknown): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }
}

function signalMember(): Member {
  const child = new ScriptedSignalCli();
  const adapter = new SignalAdapter({ account: "+5511999990000", spawn: () => child });
  return {
    key: "signal",
    adapter,
    inject: async (text) => child.receive(text),
    sent: () => child.sends,
    close: async () => adapter.disconnect(),
  };
}

const MEMBERS: ReadonlyArray<{ readonly key: PlatformName; readonly make: () => Member }> = [
  { key: "signal", make: signalMember },
];

/** Poll until `check` holds; fails naming what never happened. */
async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** A `post_outbound` hook that records the platform of every reply the runner sent. */
function countingHook(): { hook: GatewayHook; platforms: PlatformName[] } {
  const platforms: PlatformName[] = [];
  return {
    platforms,
    hook: {
      name: "count-post-outbound",
      post_outbound(ctx) {
        platforms.push(ctx.event.platform);
      },
    },
  };
}

const running: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const stop of running.splice(0)) await stop();
});

describe("GatewayRunner drives the new adapters", () => {
  it.each(MEMBERS)(
    "one inbound gives one send and one post_outbound for $key",
    async ({ key, make }) => {
      const member = make();
      const { hook, platforms } = countingHook();
      let markHandled: () => void = () => undefined;
      const handled = new Promise<void>((resolve) => {
        markHandled = resolve;
      });
      const runner = new GatewayRunner({
        adapters: [member.adapter],
        hooks: [hook],
        handler: async (_event, ctx) => {
          await ctx.reply("hello back");
          markHandled();
        },
      });
      running.push(async () => {
        await runner.stop();
        await member.close();
      });
      await runner.start();

      await member.inject("hello");
      // `ctx.reply` returns only after its post_outbound has run, so once the handler is done a
      // second send or a second hook call would already be recorded below.
      await handled;
      await until(() => platforms.length >= 1, `post_outbound for ${key}`);

      expect(member.sent()).toEqual(["hello back"]);
      expect(platforms).toEqual([key]);
    },
  );

  it.each(MEMBERS)(
    "a reply written around the runner leaves post_outbound at zero ($key)",
    async ({ make }) => {
      const member = make();
      const { hook, platforms } = countingHook();
      const runner = new GatewayRunner({
        adapters: [member.adapter],
        hooks: [hook],
        handler: async () => undefined,
      });
      running.push(async () => {
        await runner.stop();
        await member.close();
      });
      await runner.start();

      const result = await member.adapter.sendMessage({
        channel: { id: "+5511988887777", type: "dm" },
        text: "written around the runner",
      });

      expect(result.ok).toBe(true);
      expect(member.sent()).toEqual(["written around the runner"]);
      expect(platforms).toEqual([]);
    },
  );
});
