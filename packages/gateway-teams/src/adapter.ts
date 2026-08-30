/**
 * `TeamsAdapter` — Microsoft Teams platform adapter for `@theokit/gateway`
 * (Adoption Roadmap v1.4 #3; ADRs D315-D326).
 *
 * Built on the modern `@microsoft/teams.apps` v2 SDK (D315). The SDK handles
 * JWT validation (D319) and exposes an `ExpressAdapter` (D316/D326) that we
 * surface via `getExpressAdapter()` so the user can mount routes into their
 * own Express server.
 *
 * Send uses the SDK's `app.send(conversationId, activity)` (string id, not a
 * ConversationReference object — D325 inspection finding). No internal
 * conversation-reference store needed; the SDK manages routing internally.
 *
 * @public
 */

import {
  BasePlatformAdapter,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
} from "@theokit/gateway";

import { mapTeamsError } from "./errors.js";
import { normalizeTeamsActivity } from "./normalize.js";
import { splitForTeams } from "./split.js";
import type { TeamsAdapterOptions } from "./types.js";

/** Minimal shape of `@microsoft/teams.apps` `App` we use. Lazy-typed to avoid hard import. */
interface TeamsAppLike {
  initialize(): Promise<void>;
  start(port?: number | string): Promise<void>;
  stop(): Promise<void>;
  send(
    conversationId: string,
    activity: { type: "message"; text: string },
  ): Promise<{ id: string }>;
  on(name: "activity", cb: (event: unknown) => void | Promise<void>): void;
  on(name: string, cb: (event: unknown) => void | Promise<void>): void;
  // ExpressAdapter or other httpServerAdapter — opaque escape hatch.
  readonly server?: unknown;
  readonly http?: unknown;
}

/**
 * Internal factory — created here so tests can inject a fake via
 * `TeamsAdapterOptions.__appFactory`. Production uses dynamic ESM import
 * of `@microsoft/teams.apps` (`new App({...})`) — lazy because the SDK
 * pulls in ~30 MB and we only want that paid when this adapter is used.
 *
 * @internal
 */
async function createDefaultTeamsApp(opts: {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  httpServerAdapter?: unknown;
}): Promise<TeamsAppLike> {
  // Dynamic import — peer dep is required to be installed at runtime.
  // EC-1 caught at construction; here we just propagate SDK init errors.
  const mod = (await import("@microsoft/teams.apps")) as {
    App: new (cfg: unknown) => TeamsAppLike;
    ExpressAdapter?: new (app?: unknown) => unknown;
  };
  return new mod.App({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    tenantId: opts.tenantId,
    httpServerAdapter: opts.httpServerAdapter,
    // SDK built-in mention stripping (D321 + EC-9 made free).
    activity: { mentions: { stripText: true } },
  });
}

/**
 * Ask Entra for a bot token, which is the only thing that proves the three credentials.
 *
 * The SDK's `initialize()` validates none of them — measured 2026-08-28, a client id of all zeros
 * and an invented secret initialized happily — so without this, `connect()` reports a connection it
 * has never established. Every sibling adapter already asks its platform first (LINE calls
 * `getBotInfo()`, WhatsApp asks Meta); Teams was the one that did not.
 *
 * Uses the documented client-credentials endpoint rather than the SDK's `TokenManager`, which is
 * not exported from the package. Reaching into `dist/token-manager` would bind this adapter to an
 * unpublished path; the OAuth2 request is a public Microsoft contract and is what that class issues
 * underneath.
 */
async function fetchBotToken(opts: {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}): Promise<{ ok: boolean; status: number; error?: string }> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    scope: "https://api.botframework.com/.default",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(opts.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (res.ok) return { ok: true, status: res.status };
  // Entra names the reason in `error`; carrying it is what turns "connect failed" into something
  // a reader can act on.
  const detail = (await res.text().catch(() => "")).slice(0, 200);
  return { ok: false, status: res.status, error: detail };
}

export class TeamsAdapter extends BasePlatformAdapter {
  readonly platform = "teams" as const;
  private readonly opts: TeamsAdapterOptions;
  private app: TeamsAppLike | undefined;
  private handler?: (event: GatewayMessageEvent) => Promise<void>;
  private connected = false;
  // EC-5 downgraded after Phase 0: we don't need conversation refs (SDK manages),
  // but we keep a bounded Set of seen conversation ids for debug telemetry.
  private readonly seenConversations = new Set<string>();
  private static readonly MAX_SEEN_CONVERSATIONS = 1000;

  constructor(opts: TeamsAdapterOptions) {
    super();
    // EC-1: validate non-empty strings at construction (fail fast).
    for (const k of ["clientId", "clientSecret", "tenantId"] as const) {
      const v = opts[k];
      if (typeof v !== "string" || v.length === 0) {
        throw new TypeError(`TeamsAdapter: ${k} is required and must be a non-empty string`);
      }
    }
    this.opts = opts;
  }

  /** Escape hatch (D180-style) for advanced SDK features (Adaptive Cards, message extensions). */
  getApp(): unknown {
    return this.app;
  }

  /** Returns the SDK's HTTP-server adapter for mounting into a user-provided Express app (D326). */
  getExpressAdapter(): unknown {
    return this.app?.http ?? this.app?.server;
  }

  async connect(): Promise<boolean> {
    if (this.connected && this.app !== undefined) return true;
    try {
      const factory =
        (this.opts.__appFactory as
          | ((o: unknown) => Promise<TeamsAppLike> | TeamsAppLike)
          | undefined) ??
        ((o: unknown) =>
          createDefaultTeamsApp(
            o as {
              clientId: string;
              clientSecret: string;
              tenantId: string;
              httpServerAdapter?: unknown;
            },
          ));
      this.app = await Promise.resolve(
        factory({
          clientId: this.opts.clientId,
          clientSecret: this.opts.clientSecret,
          tenantId: this.opts.tenantId,
          httpServerAdapter: this.opts.httpServerAdapter,
        }),
      );
      this.app.on("activity", (event) => {
        // The SDK does not await this callback, so the promise has to be terminated here. `void`
        // alone left the rejection unhandled, and under Node 22's default that ends the process —
        // one message with a throwing handler killed the bot (#41).
        void this._dispatchActivity(event).catch((err: unknown) => {
          // Reached only by a failure in normalization or tracking: the handler's own throw is
          // caught inside, and named as the handler's, so the two are never confused.
          const m = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[teams] inbound dispatch failed: ${m}\n`);
        });
      });
      await this.app.initialize();

      // initialize() proves nothing about the credentials; ask Microsoft before claiming a
      // connection. EC-7 still holds below: a rejection returns false, it does not throw.
      const verify = this.opts.__tokenFetcher ?? fetchBotToken;
      const token = await verify({
        clientId: this.opts.clientId,
        clientSecret: this.opts.clientSecret,
        tenantId: this.opts.tenantId,
      });
      if (!token.ok) {
        console.error(
          `[teams] connect failed: Microsoft rejected the credential (${token.status})${token.error === undefined ? "" : `: ${token.error}`}`,
        );
        await this.app.stop?.();
        this.app = undefined;
        this.connected = false;
        return false;
      }

      this.connected = true;
      return true;
    } catch (err) {
      // EC-7 / D172: connect MUST NOT throw on platform errors.
      console.error("[teams] connect failed:", err instanceof Error ? err.message : err);
      this.app = undefined;
      this.connected = false;
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.app !== undefined) {
      try {
        await this.app.stop();
      } catch {
        /* swallow — disconnect must not throw */
      }
    }
    this.app = undefined;
    this.connected = false;
    this.handler = undefined;
    this.seenConversations.clear();
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return {
        ok: false,
        error: { code: "empty_text", message: "Empty text rejected." },
      };
    }
    if (!this.connected || this.app === undefined) {
      return {
        ok: false,
        error: { code: "not_connected", message: "TeamsAdapter not connected." },
      };
    }
    const parts = splitForTeams(out.text);
    if (parts.length === 0) {
      return {
        ok: false,
        error: { code: "empty_text", message: "Text reduced to zero parts after splitting." },
      };
    }
    let lastActivityId: string | undefined;
    for (const part of parts) {
      try {
        // Teams parses markup only when the activity says so. Without `textFormat` the
        // caller's declared `format` was discarded and markdown arrived as characters.
        const result = await this.app.send(out.channel.id, {
          type: "message",
          text: part,
          ...activityFormat(out.format),
        });
        lastActivityId = result?.id;
      } catch (err) {
        return { ok: false, error: mapTeamsError(err) };
      }
    }
    return lastActivityId !== undefined ? { ok: true, messageId: lastActivityId } : { ok: true };
  }

  onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    // EC-H: replace any previous subscription.
    this.handler = handler;
    // The guard is not decoration. Without it, onInbound(A) -> onInbound(B) ->
    // A's stale unsubscribe clears B, and inbound delivery stops permanently
    // with nothing logged. Email and Teams were the only two adapters of ten
    // missing it, and no test anywhere exercised the A->B->unsubA sequence.
    return () => {
      if (this.handler === handler) this.handler = undefined;
    };
  }

  /** EC-5 (downgraded): bound the seen-conversations Set with FIFO eviction. */
  private trackConversation(convId: string | undefined): void {
    if (typeof convId !== "string" || convId.length === 0) return;
    if (this.seenConversations.size >= TeamsAdapter.MAX_SEEN_CONVERSATIONS) {
      const first = this.seenConversations.values().next().value;
      if (first !== undefined) this.seenConversations.delete(first);
    }
    this.seenConversations.add(convId);
  }

  /** @internal — receives an SDK activity event; normalizes + dispatches. */
  private async _dispatchActivity(rawEvent: unknown): Promise<void> {
    if (this.handler === undefined) return;
    // Extract the activity from the event envelope (IActivityEvent or plain activity).
    const env = rawEvent as { activity?: unknown } | undefined;
    const activity = (env?.activity ?? rawEvent) as
      | { type?: string; conversation?: { id?: string } }
      | undefined;
    if (activity === undefined || activity.type !== "message") return;

    const event = normalizeTeamsActivity(activity, this.opts.botDisplayName);
    this.trackConversation(activity.conversation?.id);
    try {
      await this.handler(event);
    } catch (err) {
      // A handler is user code: it may throw, and that is not the adapter's failure nor the
      // platform's. Contain it, name it, and keep the connection delivering.
      const m = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[teams] handler threw: ${m}\n`);
    }
  }

  /** Test seam — current seen-conversation count. @internal */
  get _seenConversationsSize(): number {
    return this.seenConversations.size;
  }
}

/**
 * The `textFormat` fragment for a declared format, or nothing.
 *
 * A named function rather than a spread ternary inside the activity literal: `sendMessage` was
 * already at its cognitive-complexity limit, and a branch buried in an object literal is the
 * kind a reader skims past.
 */
function activityFormat(format: OutboundMessage["format"]): { textFormat?: "markdown" } {
  return format === "markdown" || format === "html" ? { textFormat: "markdown" } : {};
}
