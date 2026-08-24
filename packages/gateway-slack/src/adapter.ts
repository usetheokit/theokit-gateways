/**
 * `SlackAdapter` — Slack platform adapter for `@theokit/gateway` (Adoption
 * Roadmap #7; ADRs D267-D285).
 *
 * Transport: Socket Mode via `@slack/bolt` (D267, D268).
 * Inbound: normalized to `SlackMessageEvent` (D274) with bot-loop guard (D275)
 * and mention-required default for public channels (D285).
 * Outbound: `chat.postMessage` with 4000-char split (D272) + canonical
 * `SendResult` error mapping (D273).
 *
 * @public
 */

// Bolt v5 exports the App class both by name and as the default. This used to
// be `import bolt from "@slack/bolt"; const { App } = bolt;` because v3 was
// CommonJS with the NAMESPACE as its default export, so the named form was
// `undefined` at runtime. v5 inverts that — the default IS the class — so the
// old form now destructures `App` off a constructor and gets `undefined`.
//
// The two shapes are mutually exclusive, which is why the peer range names v5
// rather than spanning both. `tests/bolt-interop.test.ts` asserts this against
// the real package, since every other suite mocks Bolt and cannot see it.
import { App } from "@slack/bolt";

/**
 * The Bolt `App` INSTANCE type.
 *
 * Named apart from the class deliberately. The previous
 * `type App = InstanceType<typeof App>` worked only because `App` arrived by
 * destructuring rather than by import; with a real named import the two
 * declarations collide (TS2440). Exported so the declaration `getApp()` emits
 * refers to a name consumers can also reach.
 */
export type BoltApp = InstanceType<typeof App>;

import {
  BasePlatformAdapter,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
} from "@theokit/gateway";

import { mapSlackError } from "./errors.js";
import { type BoltMessageBody, normalizeSlackEvent } from "./normalize.js";
import { splitForSlack } from "./split.js";

/** Construction options for {@link SlackAdapter}. */
export interface SlackAdapterOptions {
  /**
   * The Slack bot user's OAuth token, beginning `xoxb-`.
   *
   * @platform-term Slack calls this a **bot token**. Note the divergence, which is deliberate:
   * `@slack/bolt` names its field `token`, and this adapter also takes an `appToken`, so `token`
   * alone would not say which of the two it is.
   * @issued-at The Slack app's OAuth & Permissions page, after installing the app to a workspace.
   */
  readonly botToken: string;
  /**
   * The Slack app-level token, beginning `xapp-`, used for Socket Mode.
   *
   * @platform-term Slack calls this an **app-level token**. It is a different object from the bot
   * token above — that one acts as the bot, this one opens the socket — which is why this adapter
   * names both explicitly rather than following `@slack/bolt`'s bare `token`.
   * @issued-at The Slack app's Basic Information page, under App-Level Tokens.
   */
  readonly appToken: string;
  /** D269: only `"socket"` is supported in v1. */
  readonly transport?: "socket";
  /** D285: when `true` (default), public-channel messages without `@bot` are dropped. */
  readonly requireMention?: boolean;
  /** Bolt log level — passed straight to the underlying App. */
  readonly logLevel?: "debug" | "info" | "warn" | "error";
}

/**
 * Slack gateway adapter over Socket Mode — the bot dials out, so inbound needs no public URL.
 *
 * Needs BOTH tokens: a bot token (`xoxb-`) to act, and an app-level token (`xapp-`, scope
 * `connections:write`) to open the socket. In public channels it answers only when mentioned unless
 * `requireMention` is set to `false`.
 */
export class SlackAdapter extends BasePlatformAdapter {
  readonly platform = "slack" as const;
  private app: BoltApp | undefined;
  private connected = false;
  private botUserId: string | undefined;
  private handler?: (event: GatewayMessageEvent) => Promise<void>;
  // EC-2: serialize concurrent connect() calls so they share one in-flight start.
  private connectingPromise?: Promise<boolean>;

  constructor(private readonly opts: SlackAdapterOptions) {
    super();
  }

  /** Escape hatch for advanced Bolt features (Block Kit, slash commands, modals). */
  getApp(): BoltApp | undefined {
    return this.app;
  }

  /** Cached bot user id (resolved via `auth.test` on connect, D277). */
  getBotUserId(): string | undefined {
    return this.botUserId;
  }

  override async connect(): Promise<boolean> {
    if (this.connected) return true;
    if (this.connectingPromise !== undefined) return this.connectingPromise;
    this.connectingPromise = this._doConnect().finally(() => {
      this.connectingPromise = undefined;
    });
    return this.connectingPromise;
  }

  private async _doConnect(): Promise<boolean> {
    try {
      this.app = new App({
        token: this.opts.botToken,
        appToken: this.opts.appToken,
        socketMode: true,
        ...(this.opts.logLevel !== undefined
          ? // biome-ignore lint/suspicious/noExplicitAny: Bolt's LogLevel enum is a runtime const
            { logLevel: this.opts.logLevel as any }
          : {}),
      });
      this.app.event("message", async (args: { body: unknown }) => this.handleMessage(args));
      await this.app.start();
      // D277: cache botUserId via auth.test for loop guard.
      const auth = await this.app.client.auth.test();
      this.botUserId = String(auth.user_id ?? "");
      this.connected = true;
      return true;
    } catch (err) {
      // D279 / EC-1: never throw; clean up orphan App if start() succeeded but auth.test failed.
      process.stderr.write(
        `[slack-adapter] connect failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      if (this.app !== undefined) {
        await this.app.stop().catch(() => undefined);
      }
      this.app = undefined;
      this.botUserId = undefined;
      return false;
    }
  }

  override async disconnect(): Promise<void> {
    // Wait for an in-flight connect before deciding there is nothing to stop.
    // `connected` only flips after BOTH start() and auth.test() resolve, so a
    // disconnect arriving in that window used to return immediately against a
    // socket that was still opening — and nothing held a reference able to
    // close it afterwards (#31). Swallow its failure: a connect that already
    // failed cleaned up after itself, and disconnect() does not report it.
    if (this.connectingPromise !== undefined) {
      await this.connectingPromise.catch(() => undefined);
    }
    // D278: idempotent + safe before connect. Guarded on the App rather than on
    // `connected`, so a half-connected one is still torn down.
    if (this.app === undefined) return;
    try {
      await this.app.stop();
    } catch (err) {
      process.stderr.write(
        `[slack-adapter] disconnect error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    this.app = undefined;
    this.connected = false;
    this.botUserId = undefined;
  }

  private async postChunk(
    out: OutboundMessage,
    chunk: string,
  ): Promise<string | undefined | SendResult> {
    try {
      const resp = await this.app?.client.chat.postMessage({
        channel: out.channel.id,
        text: chunk,
        ...(out.channel.topicId !== undefined ? { thread_ts: out.channel.topicId } : {}),
        // D281: plain | markdown only; Block Kit deferred to v1.x.
        ...(out.format === "markdown" ? { mrkdwn: true } : {}),
      });
      return typeof resp?.ts === "string" ? resp.ts : undefined;
    } catch (err) {
      return mapSlackError(err);
    }
  }

  override async sendMessage(out: OutboundMessage): Promise<SendResult> {
    // Input first, transport second — the order the other nine adapters use and the one the
    // contract states without a condition. Checking the connection first made the same empty-text
    // call answer `not_connected` here and `empty_text` everywhere else, so a caller branching on
    // the code to separate bad input from an unavailable transport took the wrong branch on exactly
    // one platform (#42).
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "text is empty" } };
    }
    // EC-6: also gate on `connected` — `this.app` is set synchronously before
    // `app.start()` completes, so a send in-between would otherwise leak through.
    if (this.app === undefined || !this.connected) {
      return { ok: false, error: { code: "not_connected", message: "adapter not connected" } };
    }

    let lastId: string | undefined;
    for (const chunk of splitForSlack(out.text)) {
      const result = await this.postChunk(out, chunk);
      if (typeof result === "object" && result !== null) return result;
      lastId = result;
    }
    return { ok: true, ...(lastId !== undefined ? { messageId: lastId } : {}) };
  }

  override onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    // D276 / EC-H: second call replaces previous.
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = undefined;
    };
  }

  private async handleMessage(args: { body: unknown }): Promise<void> {
    if (this.handler === undefined) return;
    const event = normalizeSlackEvent(args.body as BoltMessageBody, this.botUserId, {
      requireMention: this.opts.requireMention ?? true,
    });
    if (event === undefined) return;
    try {
      await this.handler(event);
    } catch (err) {
      process.stderr.write(
        `[slack-adapter] handler threw: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}
