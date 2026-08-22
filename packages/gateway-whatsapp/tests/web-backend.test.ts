/**
 * `WhatsAppWebBackend` tests (T3.3 + EC-6, EC-11).
 *
 * Uses a controllable fake child process so we don't depend on whatsapp-web.js
 * or Puppeteer in unit tests.
 */

import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { defaultBridgeScriptPath, WhatsAppWebBackend } from "../src/backend/web/index.js";
import type { BridgeHandle } from "../src/backend/web/lifecycle.js";
import { WhatsAppConnectTimeoutError } from "../src/errors.js";

/** A fake `ChildProcess` we can drive from tests. */
class FakeChild extends EventEmitter {
  pid = 12345;
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly stdin = new (class extends Writable {
    written: string[] = [];
    override destroyed = false;
    override _write(chunk: Buffer | string, _enc: string, cb: () => void): void {
      this.written.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      cb();
    }
  })();
  readonly stdout = new Readable({ read() {} });
  readonly stderr = new Readable({ read() {} });

  kill(_signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    this.signalCode = "SIGTERM";
    this.exitCode = 0;
    process.nextTick(() => this.emit("exit", 0, "SIGTERM"));
    return true;
  }
}

function makeHandle(): { handle: BridgeHandle; child: FakeChild } {
  const child = new FakeChild();
  const handle: BridgeHandle = {
    child: child as unknown as BridgeHandle["child"],
    pidFilePath: "/tmp/fake.pid",
  };
  return { handle, child };
}

function feed(child: FakeChild, line: string): void {
  child.stdout.push(line);
}

describe("WhatsAppWebBackend — connect", () => {
  it("test_web_backend_connect_spawns_and_awaits_ready", async () => {
    const { handle, child } = makeHandle();
    const backend = new WhatsAppWebBackend({
      sessionId: "test",
      spawnFactory: () => handle,
      connectTimeoutMs: 500,
    });
    const connectPromise = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    feed(child, '{"event":"ready","botPhone":"5511999999999"}\n');
    expect(await connectPromise).toBe(true);
    await backend.disconnect();
  });

  it("test_web_backend_connect_times_out_after_120s (EC-6)", async () => {
    const { handle } = makeHandle();
    const backend = new WhatsAppWebBackend({
      sessionId: "test",
      spawnFactory: () => handle,
      connectTimeoutMs: 50, // short for the test
    });
    await expect(backend.connect()).rejects.toBeInstanceOf(WhatsAppConnectTimeoutError);
  });
});

describe("WhatsAppWebBackend — send + IPC dispatch", () => {
  it("test_web_backend_send_matches_ack_by_msgid", async () => {
    const { handle, child } = makeHandle();
    const backend = new WhatsAppWebBackend({
      sessionId: "test",
      spawnFactory: () => handle,
      connectTimeoutMs: 500,
      sendTimeoutMs: 500,
    });
    const connectP = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    feed(child, '{"event":"ready","botPhone":"5511"}\n');
    await connectP;

    const sendP = backend.send({ to: "5511", isGroup: false, text: "hi" });
    // Wait for the bridge to write the command, then feed back an ack.
    await new Promise((r) => setTimeout(r, 10));
    const written = child.stdin.written[0]!;
    const cmd = JSON.parse(written) as { msgId: string };
    feed(
      child,
      JSON.stringify({ event: "send_ack", msgId: cmd.msgId, success: true, wamid: "wamid.acked" }) +
        "\n",
    );

    const r = await sendP;
    expect(r.ok).toBe(true);
    expect(r.wamid).toBe("wamid.acked");
    await backend.disconnect();
  });

  it("test_web_backend_send_times_out", async () => {
    const { handle, child } = makeHandle();
    const backend = new WhatsAppWebBackend({
      sessionId: "test",
      spawnFactory: () => handle,
      connectTimeoutMs: 500,
      sendTimeoutMs: 50,
    });
    const connectP = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    feed(child, '{"event":"ready","botPhone":"5511"}\n');
    await connectP;

    const r = await backend.send({ to: "5511", isGroup: false, text: "hi" });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("timeout");
    await backend.disconnect();
  });

  it("test_web_backend_dispatches_inbound_message", async () => {
    const { handle, child } = makeHandle();
    const backend = new WhatsAppWebBackend({
      sessionId: "test",
      spawnFactory: () => handle,
      connectTimeoutMs: 500,
    });
    const handler = vi.fn(async () => {});
    backend.onInbound(handler);
    const connectP = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    feed(child, '{"event":"ready","botPhone":"5511"}\n');
    await connectP;

    feed(
      child,
      `${JSON.stringify({
        event: "message",
        msgId: "wamid.in.1",
        from: "5511888",
        body: "hi",
        isGroup: false,
        chatId: "5511888",
        timestamp: 1700_000_000_000,
      })}\n`,
    );
    // Let microtasks run.
    await new Promise((r) => setTimeout(r, 20));
    expect(handler).toHaveBeenCalledTimes(1);
    await backend.disconnect();
  });

  it("test_web_backend_dispatches_status_receipt", async () => {
    const { handle, child } = makeHandle();
    const backend = new WhatsAppWebBackend({
      sessionId: "test",
      spawnFactory: () => handle,
      connectTimeoutMs: 500,
    });
    const handler = vi.fn(async () => {});
    backend.onStatusReceipt(handler);
    const connectP = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    feed(child, '{"event":"ready","botPhone":"5511"}\n');
    await connectP;

    feed(
      child,
      `${JSON.stringify({
        event: "status",
        msgId: "wamid.s",
        status: "delivered",
        recipient: "5511",
        timestamp: 1700,
      })}\n`,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(handler).toHaveBeenCalledTimes(1);
    await backend.disconnect();
  });

  it("test_web_backend_ipc_buffers_fragmented_line (EC-11)", async () => {
    const { handle, child } = makeHandle();
    const backend = new WhatsAppWebBackend({
      sessionId: "test",
      spawnFactory: () => handle,
      connectTimeoutMs: 500,
    });
    const connectP = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    feed(child, '{"event":"rea');
    await new Promise((r) => setTimeout(r, 10));
    feed(child, 'dy","botPhone":"5511"}\n');
    expect(await connectP).toBe(true);
    await backend.disconnect();
  });
});

describe("WhatsAppWebBackend — a throwing handler", () => {
  /** A connected backend fed by a fake bridge, ready to receive IPC lines. */
  async function connected() {
    const { handle, child } = makeHandle();
    const backend = new WhatsAppWebBackend({
      sessionId: "test",
      spawnFactory: () => handle,
      connectTimeoutMs: 500,
    });
    const connecting = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    feed(child, '{"event":"ready","botPhone":"5511999999999"}\n');
    await connecting;
    return { backend, child };
  }

  const MESSAGE_LINE =
    '{"event":"message","msgId":"m1","from":"5511888888888","chatId":"c1","body":"hi","timestamp":1,"isGroup":false}\n';

  it("contains an inbound handler that throws, instead of taking the process down", async () => {
    // `void this.inboundHandler(normalized)` discarded the rejection. Under Node 22's default an
    // unhandled rejection ends the process, so one message with a throwing handler killed the bot
    // — measured against this backend through the same fake bridge these tests use (#41).
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { backend, child } = await connected();
    backend.onInbound(async () => {
      throw new Error("user handler blew up");
    });

    feed(child, MESSAGE_LINE);
    await new Promise((r) => setTimeout(r, 10));

    const written = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("[whatsapp-web] handler threw: user handler blew up");
    await backend.disconnect();
    stderr.mockRestore();
  });

  it("keeps delivering after an inbound handler throws", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { backend, child } = await connected();
    const seen: string[] = [];
    backend.onInbound(async (event) => {
      seen.push(event.text);
      throw new Error("user handler blew up");
    });

    feed(child, MESSAGE_LINE);
    await new Promise((r) => setTimeout(r, 10));
    feed(child, MESSAGE_LINE.replace('"body":"hi"', '"body":"second"'));
    await new Promise((r) => setTimeout(r, 10));

    expect(seen).toEqual(["hi", "second"]);
    await backend.disconnect();
    stderr.mockRestore();
  });

  it("contains a status-receipt handler that throws", async () => {
    // Same shape, same `void`, one method further down — and a delivery receipt is exactly the kind
    // of event a user handler writes to a database from, which is where the throws come from.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { backend, child } = await connected();
    backend.onStatusReceipt(async () => {
      throw new Error("receipt handler blew up");
    });

    feed(
      child,
      '{"event":"status","msgId":"m1","status":"delivered","recipient":"5511888888888","timestamp":1}\n',
    );
    await new Promise((r) => setTimeout(r, 10));

    const written = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("[whatsapp-web] status handler threw: receipt handler blew up");
    await backend.disconnect();
    stderr.mockRestore();
  });
});

describe("WhatsAppWebBackend — spawning the real bridge", () => {
  /** A minimal bridge that reports a failure the way the real one does, and exits. */
  function fakeBridge(dir: string): string {
    const script = join(dir, "fake-bridge.mjs");
    writeFileSync(
      script,
      [
        'process.stdout.write(JSON.stringify({ event: "error", message: "stub could not start", code: "peer_missing" }) + "\\n");',
        "setTimeout(() => process.exit(1), 20);",
        "",
      ].join("\n"),
    );
    return script;
  }

  it("fails connect() with the reported cause instead of waiting out the timeout", async () => {
    // The wiring the fix claimed and did not have. `connect()` raced only the `ready`
    // promise, and a bridge that said exactly what was wrong had its message written to
    // stderr and dropped — so the caller still paid the full connectTimeoutMs and got a
    // timeout, the one error that carries no cause.
    const dir = mkdtempSync(join(tmpdir(), "wa-spawn-"));
    try {
      const backend = new WhatsAppWebBackend({
        sessionId: `spawn-${process.pid}`,
        bridgeScriptPath: fakeBridge(dir),
        connectTimeoutMs: 30_000,
        theokitHome: dir,
      });
      const startedAt = Date.now();

      await expect(backend.connect()).rejects.toMatchObject({
        name: "WhatsAppBridgeError",
        code: "peer_missing",
      });

      // The point is the speed: a timeout would have taken 30s.
      expect(Date.now() - startedAt).toBeLessThan(10_000);
      await backend.disconnect();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45_000);

  it("resolves a bridge script that exists, in whichever layout it runs from", () => {
    expect(existsSync(defaultBridgeScriptPath())).toBe(true);
  });

  it("resolves the bridge from the BUILT package, which is what consumers get", async (ctx) => {
    // The test above cannot catch the defect it describes. It runs against `src/`, where the
    // old `../../bridge/` walk was correct — `src/backend/web/` up two is `src/`. The bundle
    // is one flat file at `dist/index.js`, so the same walk landed on `packages/bridge/`,
    // one directory above the package, and the child died with MODULE_NOT_FOUND while
    // connect() reported a 120-second timeout.
    //
    // Only the built artifact exercises that path, so this asserts against it and skips
    // loudly when the package has not been built rather than passing on absence.
    const dist = join(import.meta.dirname, "..", "dist", "index.js");
    ctx.skip(!existsSync(dist), "package not built — run `pnpm build` to cover the bundled layout");

    const built = (await import(pathToFileURL(dist).href)) as {
      defaultBridgeScriptPath: () => string;
    };

    expect(existsSync(built.defaultBridgeScriptPath())).toBe(true);
  });
});

describe("WhatsAppWebBackend — connect() bookkeeping", () => {
  it("does not accumulate callbacks across failed connects", async () => {
    // Found by an independent verifier of the review fixes, not by the review itself. Both
    // arrays hold settled callbacks once the race is decided, and neither was cleared on the
    // timeout path: handleBridgeError never runs, and disconnect() returns early while
    // `connected` is false. A reconnect loop grew them by one per attempt, forever.
    const dir = mkdtempSync(join(tmpdir(), "wa-leak-"));
    try {
      // A bridge that says nothing, so every attempt fails by timeout — the leaking path.
      const silent = join(dir, "silent-bridge.mjs");
      writeFileSync(silent, "setTimeout(() => process.exit(0), 5_000);\n");
      const backend = new WhatsAppWebBackend({
        sessionId: `leak-${process.pid}`,
        bridgeScriptPath: silent,
        connectTimeoutMs: 120,
        theokitHome: dir,
      });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await expect(backend.connect()).rejects.toBeInstanceOf(WhatsAppConnectTimeoutError);
      }

      const internals = backend as unknown as {
        readyResolvers: unknown[];
        connectRejectors: unknown[];
      };
      expect(internals.readyResolvers).toEqual([]);
      expect(internals.connectRejectors).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45_000);
});
