/**
 * `WhatsAppWebBackend` — `whatsapp-web.js` subprocess bridge backend (ADR D305).
 *
 * Lifecycle (T3.1) + IPC (T3.2) wired behind the `WhatsAppBackend` interface.
 * EC-6 absorbed: `connect()` races against a 120s timeout so unattended QR
 * pairings fail fast instead of hanging the app.
 *
 * **THE CONSUMER MUST PROVIDE A BROWSER.** `whatsapp-web.js` drives a real Chrome through
 * Puppeteer, and this package ships none: the repository leaves `puppeteer` out of
 * `pnpm.onlyBuiltDependencies`, so its postinstall never downloads one. Without a browser the
 * bridge starts, cannot find Chrome, and says so in its own protocol rather than crashing —
 * which is the whole of the B-002 fix, and is still not a connection. Set
 * `PUPPETEER_EXECUTABLE_PATH` to a Chrome or Chromium you already have; the bridge is spawned
 * without an explicit `env`, so it inherits yours.
 *
 * B-002 asked for exactly this sentence or for a buildable `puppeteer`, and shipped with
 * neither. Measured 2026-08-29: with the variable set, the bridge reaches WhatsApp and issues
 * a pairing QR. {@link WhatsAppBaileysBackend} needs no browser, which is why it exists.
 *
 * @public
 */

import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  WhatsAppBackend,
  WhatsAppInboundEvent,
  WhatsAppOutboundMessage,
  WhatsAppSendResult,
  WhatsAppStatusReceipt,
} from "../../backend-types.js";
import {
  mapWhatsAppWebError,
  WhatsAppBridgeError,
  WhatsAppConnectTimeoutError,
} from "../../errors.js";
import { formatCommand, type IpcEvent, LineBuffer, parseEvent } from "./ipc.js";
import { type BridgeHandle, spawnBridge, terminateBridge } from "./lifecycle.js";

export interface WhatsAppWebBackendOptions {
  readonly sessionId: string;
  /** Override the default bridge script path. Defaults to bundled script. */
  readonly bridgeScriptPath?: string;
  /** EC-6 connect timeout in ms. Default 120000. */
  readonly connectTimeoutMs?: number;
  /** Per-send timeout in ms. Default 30000. */
  readonly sendTimeoutMs?: number;
  /** Test seam: override the spawned child via a factory. */
  readonly spawnFactory?: () => BridgeHandle;
  /** Test seam: theokit home for PID locks. */
  readonly theokitHome?: string;
}

interface PendingSend {
  readonly resolve: (r: WhatsAppSendResult) => void;
  readonly timer: NodeJS.Timeout;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 120_000;
const DEFAULT_SEND_TIMEOUT_MS = 30_000;

/**
 * WhatsApp backend driving `whatsapp-web.js` in a child process.
 *
 * Unofficial: it automates a WhatsApp Web session, which Meta's terms do not sanction and which can
 * get a number banned. It exists for a personal number that has no Cloud API access. The browser
 * runs out-of-process behind a PID lock so a crashed or orphaned bridge cannot be left holding the
 * session.
 */
export class WhatsAppWebBackend implements WhatsAppBackend {
  readonly kind = "web" as const;
  private handle?: BridgeHandle;
  private readonly buffer = new LineBuffer();
  private inboundHandler?: (event: WhatsAppInboundEvent) => Promise<void>;
  private statusHandler?: (receipt: WhatsAppStatusReceipt) => Promise<void>;
  private readonly pending = new Map<string, PendingSend>();
  /** Rejects an in-flight `connect()` when the bridge reports it cannot start. */
  private connectRejectors: Array<(reason: Error) => void> = [];
  private msgIdCounter = 0;
  private botPhone?: string;
  private connected = false;
  // EC-6: emitter resolvers for `event: "ready"`.
  private readyResolvers: Array<(phone: string) => void> = [];

  constructor(private readonly opts: WhatsAppWebBackendOptions) {}

  private spawnBridgeHandle(): NonNullable<typeof this.handle> {
    return this.opts.spawnFactory
      ? this.opts.spawnFactory()
      : spawnBridge({
          sessionId: this.opts.sessionId,
          bridgeScriptPath: this.opts.bridgeScriptPath ?? defaultBridgeScriptPath(),
          ...(this.opts.theokitHome !== undefined ? { theokitHome: this.opts.theokitHome } : {}),
        });
  }

  private wireStdout(): void {
    if (this.handle?.child.stdout === null || this.handle === undefined) return;
    this.handle.child.stdout.setEncoding("utf8");
    this.handle.child.stdout.on("data", (chunk: string) => {
      for (const line of this.buffer.push(chunk)) {
        const event = parseEvent(line);
        if (event !== null) this.dispatch(event);
      }
    });
  }

  private async cleanupHandle(): Promise<void> {
    if (this.handle === undefined) return;
    await terminateBridge(this.handle).catch(() => {});
    this.handle = undefined;
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    this.handle = this.spawnBridgeHandle();
    this.wireStdout();

    const timeoutMs = this.opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const ready = new Promise<string>((resolve, reject) => {
      this.readyResolvers.push(resolve);
      // The bridge reporting a startup failure resolves the race immediately, so the caller
      // learns the cause instead of waiting out the timeout.
      this.connectRejectors.push(reject);
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new WhatsAppConnectTimeoutError(timeoutMs)), timeoutMs);
    });

    try {
      const phone = await Promise.race([ready, timeout]);
      this.botPhone = phone;
      this.connected = true;
      return true;
    } catch (err) {
      await this.cleanupHandle();
      throw err;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      // Both arrays hold settled callbacks once the race is decided, and neither was cleared
      // on the path that fails by timeout — `handleBridgeError` never ran, and `disconnect()`
      // returns early while `connected` is false. A reconnect loop therefore grew them by one
      // per attempt forever. `readyResolvers` had the same leak before this method learned to
      // reject; clearing them together is the whole fix.
      this.readyResolvers = [];
      this.connectRejectors = [];
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected || this.handle === undefined) return;
    try {
      if (this.handle.child.stdin !== null && !this.handle.child.stdin.destroyed) {
        this.handle.child.stdin.write(formatCommand({ cmd: "shutdown" }));
      }
    } catch {
      /* ignore */
    }
    await terminateBridge(this.handle);
    this.handle = undefined;
    this.connected = false;
    // Reject any pending sends.
    for (const [_, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: { code: "server_error", message: "Bridge disconnected." } });
    }
    this.pending.clear();
    this.readyResolvers = [];
    this.connectRejectors = [];
  }

  async send(message: WhatsAppOutboundMessage): Promise<WhatsAppSendResult> {
    if (!this.connected || this.handle === undefined || this.handle.child.stdin === null) {
      return { ok: false, error: { code: "not_connected", message: "Bridge not connected." } };
    }
    const msgId = `out-${++this.msgIdCounter}`;
    const timeoutMs = this.opts.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
    return new Promise<WhatsAppSendResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(msgId);
        resolve({
          ok: false,
          error: { code: "timeout", message: `Bridge send timed out after ${timeoutMs}ms.` },
        });
      }, timeoutMs);
      this.pending.set(msgId, { resolve, timer });
      try {
        this.handle!.child.stdin!.write(
          formatCommand({ cmd: "send", msgId, to: message.to, text: message.text }),
        );
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(msgId);
        resolve({
          ok: false,
          error: mapWhatsAppWebError(err instanceof Error ? err.message : String(err)),
        });
      }
    });
  }

  onInbound(handler: (event: WhatsAppInboundEvent) => Promise<void>): () => void {
    this.inboundHandler = handler;
    return () => {
      // Identity-guarded: a stale unsubscribe must be a no-op. Without it,
      // `onInbound(A)` → `onInbound(B)` → `A.off()` clears B's handler and the backend goes
      // silent with no error — nothing to see in a log, nothing to alert on. This is a public
      // export implementing an exported interface, so a consumer holding the backend directly
      // reaches it without going through `WhatsAppAdapter`.
      if (this.inboundHandler === handler) this.inboundHandler = undefined;
    };
  }

  onStatusReceipt(handler: (receipt: WhatsAppStatusReceipt) => Promise<void>): () => void {
    this.statusHandler = handler;
    return () => {
      if (this.statusHandler === handler) this.statusHandler = undefined;
    };
  }

  private handleReady(event: Extract<IpcEvent, { event: "ready" }>): void {
    for (const r of this.readyResolvers) r(event.botPhone);
    this.readyResolvers = [];
  }

  private handleMessage(event: Extract<IpcEvent, { event: "message" }>): void {
    if (this.inboundHandler === undefined) return;
    const normalized: WhatsAppInboundEvent = {
      wamid: event.msgId,
      fromPhone: event.from,
      contactName: event.contactName,
      conversationType: event.isGroup ? "group" : "dm",
      channelId: event.chatId,
      text: event.body,
      receivedAt: event.timestamp || Date.now(),
      backend: "web",
      raw: event,
    };
    // The bridge's stdout listener is synchronous and does not await this, so the promise has to be
    // terminated here. `void` alone left the rejection unhandled, and under Node 22's default that
    // ends the process — one message with a throwing handler killed the bot (#41). A handler is
    // user code; its failure is contained and named, and the bridge keeps delivering.
    void this.inboundHandler(normalized).catch((err: unknown) => {
      const m = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[whatsapp-web] handler threw: ${m}\n`);
    });
  }

  /**
   * A bridge that reported a failure has failed — say so now, not in two minutes.
   *
   * This used to write the message to stderr and return. `connect()` races only the `ready`
   * promise against the timeout, so a bridge that told us exactly what was wrong and exited
   * still cost the caller the full `connectTimeoutMs` and surfaced as a timeout — the one
   * error that carries no information. The diagnosis was printed where nothing could act on
   * it, which is the swallowing `rules/error-handling.md` § 5 names.
   */
  private handleBridgeError(event: Extract<IpcEvent, { event: "error" }>): void {
    process.stderr.write(`[whatsapp-web bridge] ${event.message}\n`);
    const failure = new WhatsAppBridgeError(event.message, event.code);
    // Unblocks an in-flight connect(). Harmless once connected: nobody is waiting.
    for (const reject of this.connectRejectors) reject(failure);
    this.connectRejectors = [];
  }

  private handleSendAck(event: Extract<IpcEvent, { event: "send_ack" }>): void {
    const pending = this.pending.get(event.msgId);
    if (pending === undefined) return;
    this.pending.delete(event.msgId);
    clearTimeout(pending.timer);
    if (event.success) {
      pending.resolve(event.wamid !== undefined ? { ok: true, wamid: event.wamid } : { ok: true });
    } else {
      pending.resolve({ ok: false, error: mapWhatsAppWebError(event.error) });
    }
  }

  private handleStatus(event: Extract<IpcEvent, { event: "status" }>): void {
    if (this.statusHandler === undefined) return;
    // Same boundary as handleMessage: nothing awaits this, so an unhandled rejection here is fatal.
    void this.statusHandler({
      wamid: event.msgId,
      status: event.status,
      recipient: event.recipient,
      timestamp: event.timestamp || Date.now(),
    }).catch((err: unknown) => {
      const m = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[whatsapp-web] status handler threw: ${m}\n`);
    });
  }

  private dispatch(event: IpcEvent): void {
    switch (event.event) {
      case "ready":
        this.handleReady(event);
        return;
      case "message":
        this.handleMessage(event);
        return;
      case "send_ack":
        this.handleSendAck(event);
        return;
      case "status":
        this.handleStatus(event);
        return;
      case "error":
        this.handleBridgeError(event);
        return;
    }
  }
}

/**
 * Where the bridge script lives, for the layout this module is running from.
 *
 * The single hard-coded `../../bridge/...` this replaced was written against the SOURCE
 * tree — `src/backend/web/` up two is `src/`, which is right. The bundle is one flat file
 * at `dist/index.js`, so the same relative path resolved to `packages/bridge/...`, one
 * directory above the package. Nothing caught it: every test injects `spawnFactory`, so the
 * real spawn had never run, and when it did the child died with `MODULE_NOT_FOUND` and
 * `connect()` reported a 120-second timeout — the one error carrying no information about
 * what actually happened.
 *
 * Both layouts are checked, and neither existing is an error rather than a guess: a path
 * that does not exist can only fail later, further from the cause.
 */
export function defaultBridgeScriptPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Bundled: dist/index.js beside dist/bridge/
    path.resolve(here, "bridge/whatsapp-web-bridge.mjs"),
    // Source: src/backend/web/index.ts up two to src/
    path.resolve(here, "../../bridge/whatsapp-web-bridge.mjs"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new WhatsAppBridgeError(
      `bridge script not found. Looked in: ${candidates.join(", ")}. ` +
        "Pass `bridgeScriptPath` explicitly if the package layout differs.",
      "bridge_script_missing",
    );
  }
  return found;
}
