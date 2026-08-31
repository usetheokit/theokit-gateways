/**
 * The socket contract this backend depends on, and the real factory behind it (ADR D319).
 *
 * Three members, not Baileys' whole `WASocket`. Two things follow, and both are the reason
 * the contract is ours rather than the library's.
 *
 * It was five, and two rounds of review took two members off it, both declared and called by
 * nothing. `logout()` went first and mattered most: on WhatsApp it UNPAIRS the device, the
 * opposite of what `disconnect()` means here, so the next person needing a teardown would find
 * it, call it, and lose the session the whole `sessionDir` exists to keep. `ev.off()` went for
 * the plain reason — nothing removed a listener, because a socket is discarded whole rather
 * than unsubscribed from. Neither was a capability we had; both read as one.
 *
 * **The backend is testable with `baileys` absent.** It is an optional peer dependency, so
 * CI does not install it — and a backend that could only be exercised with the real library
 * installed would be exercised by nothing, which is how the `web` backend reached production
 * unable to start (B-002).
 *
 * **The library stays an implementation detail of this file.** A breaking change upstream
 * lands in one place instead of wherever its types had spread. Depending on all of `WASocket`
 * to call three of its members is the interface-segregation problem stated plainly
 * (`rules/architecture.md`).
 *
 * @internal
 */

import { ConfigurationError } from "../../errors.js";

/** A Baileys connection-state update, narrowed to what the lifecycle reads. */
export interface BaileysConnectionUpdate {
  readonly connection?: "close" | "connecting" | "open";
  readonly qr?: string;
  readonly lastDisconnect?: { readonly error?: unknown };
}

/** The events this backend subscribes to. Anything else Baileys emits is ignored. */
export interface BaileysEventMap {
  "connection.update": BaileysConnectionUpdate;
  "messages.upsert": { readonly messages: readonly unknown[]; readonly type?: string };
  "creds.update": unknown;
}

/**
 * What this backend needs a socket to be.
 *
 * Deliberately structural: any object with these members satisfies it, which is what lets a
 * test hand over a fake without importing anything from Baileys.
 */
export interface BaileysSocketLike {
  readonly ev: {
    on<K extends keyof BaileysEventMap>(
      event: K,
      listener: (payload: BaileysEventMap[K]) => void,
    ): void;
  };
  sendMessage(
    jid: string,
    content: { text: string },
  ): Promise<{ key?: { id?: string } } | undefined>;
  /**
   * Ask the server which numbers are registered, and under which JID it routes them.
   *
   * Optional because an older Baileys, or a fake in a test that predates this, may not have it.
   * When it is absent the backend sends to the number as given — the behaviour before #82 — rather
   * than refusing everything, because refusing on a missing capability would turn an upgrade
   * problem into an outage.
   */
  onWhatsApp?(...numbers: string[]): Promise<Array<{ exists?: boolean; jid?: string }> | undefined>;
  /**
   * Who this socket logged in as — present once the connection opens.
   *
   * Optional because a socket that never opened has no identity to report, and because tests
   * replace this object wholesale. The backend reads BOTH ids: the self-chat is addressed by
   * `lid`, not by `id`, so knowing only one leaves it unrecognised.
   */
  readonly user?: { readonly id?: string; readonly lid?: string };
  end?(error?: Error): void;
}

/** How a socket comes into being. Replaced wholesale in tests. */
export type BaileysSocketFactory = (opts: BaileysSocketOptions) => Promise<BaileysSocketLike>;

/** What the real factory needs to build a socket. */
export interface BaileysSocketOptions {
  /** Directory holding the multi-file auth state — the pairing, persisted. */
  readonly sessionDir: string;
  /** Overrides the module the factory loads. Tests point it at a stub; production never sets it. */
  readonly specifier?: string;
  /**
   * Called with the pairing QR, as often as WhatsApp reissues it.
   *
   * Without somewhere for this to go, a fresh `sessionDir` can only ever time out: there is
   * no other way to pair, and `printQRInTerminal` is off because a library writing to stdout
   * is a library deciding where a host application's output goes. Defaults to writing the
   * code to **stderr**, which is what the `web` bridge does and what keeps stdout free for a
   * host that is using it for something.
   */
  readonly onQr?: (qr: string) => void;
}

/** Shape of the `baileys` module surface this factory uses. */
interface BaileysModule {
  makeWASocket?: (config: Record<string, unknown>) => BaileysSocketLike;
  default?: ((config: Record<string, unknown>) => BaileysSocketLike) | BaileysModule;
  useMultiFileAuthState?: (
    dir: string,
  ) => Promise<{ state: unknown; saveCreds: () => Promise<void> }>;
  fetchLatestBaileysVersion?: () => Promise<{ version: unknown }>;
}

/** Read a member off the default export first, then the namespace. */
function member<T>(mod: BaileysModule, name: keyof BaileysModule): T | undefined {
  const asDefault = mod.default as BaileysModule | undefined;
  const fromDefault =
    asDefault !== undefined && typeof asDefault === "object" ? asDefault[name] : undefined;
  return (fromDefault ?? mod[name]) as T | undefined;
}

/**
 * Build a real Baileys socket.
 *
 * The import shape follows what B-002 cost this repository to learn: read the API off the
 * default export first, check each member is callable, and report a structured error naming
 * the one that is missing. A `try/catch` around the import guards the package being absent,
 * not a member being undefined — and that gap is what killed the `web` bridge for months
 * behind a friendly "not installed" message that was false.
 *
 * The socket settings are ADR D322, each for a stated consequence rather than a precedent:
 * `markOnlineOnConnect: false` so the account does not read as permanently online and
 * suppress push notifications on the owner's real phone; `syncFullHistory: false` so a
 * connect does not pull the entire history; an honest `browser` triple; and the protocol
 * version fetched at connect, because a stale one is refused by the server.
 */
export async function createBaileysSocket(opts: BaileysSocketOptions): Promise<BaileysSocketLike> {
  const specifier = opts.specifier ?? "baileys";

  let mod: BaileysModule;
  try {
    mod = (await import(/* @vite-ignore */ specifier)) as BaileysModule;
  } catch (err) {
    throw new ConfigurationError({
      code: "peer_missing",
      message:
        `gateway-whatsapp: ${specifier} is not installed. ` +
        "Run `pnpm add baileys` to use the baileys backend. " +
        `(${err instanceof Error ? err.message : String(err)})`,
    });
  }

  const makeSocket = member<(config: Record<string, unknown>) => BaileysSocketLike>(
    mod,
    "makeWASocket",
  );
  const useAuthState = member<
    (dir: string) => Promise<{ state: unknown; saveCreds: () => Promise<void> }>
  >(mod, "useMultiFileAuthState");
  const fetchVersion = member<() => Promise<{ version: unknown }>>(
    mod,
    "fetchLatestBaileysVersion",
  );

  for (const [name, value] of [
    ["makeWASocket", makeSocket],
    ["useMultiFileAuthState", useAuthState],
  ] as const) {
    if (typeof value !== "function") {
      throw new ConfigurationError({
        code: "peer_incompatible",
        message:
          `gateway-whatsapp: ${specifier} is installed but does not export ${name} as a function. ` +
          `Expected a function, got ${typeof value}. The baileys backend expects the peer range ` +
          "declared in @theokit/gateway-whatsapp.",
      });
    }
  }

  // Non-null after the loop above, which exits the process path on anything else.
  const { state, saveCreds } = await (
    useAuthState as (dir: string) => Promise<{ state: unknown; saveCreds: () => Promise<void> }>
  )(opts.sessionDir);

  // A stale protocol version is refused by the server. Absent this export we still connect;
  // Baileys then uses its bundled default, which is a worse guess but not a failure.
  const version = typeof fetchVersion === "function" ? (await fetchVersion()).version : undefined;

  const socket = (makeSocket as (config: Record<string, unknown>) => BaileysSocketLike)({
    auth: state,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    browser: ["theokit-gateway", "chrome", "1.0.0"],
    ...(version !== undefined ? { version } : {}),
  });

  // The pairing surface (F4). `printQRInTerminal` stays false — a library writing to stdout
  // decides where a host's output goes — so the code is handed to the caller, defaulting to
  // stderr. Without this a fresh session directory has no path to a pairing at all.
  const onQr =
    opts.onQr ??
    ((qr: string) => {
      process.stderr.write(
        `\n[whatsapp-baileys] Scan this QR with WhatsApp — Settings, Linked devices, Link a device:\n${qr}\n\n`,
      );
    });
  socket.ev.on("connection.update", (update) => {
    if (typeof update.qr === "string" && update.qr.length > 0) onQr(update.qr);
  });

  socket.ev.on("creds.update", () => {
    // Persisting credentials is what makes a pairing survive a restart. The callback is
    // sync, so the promise is deliberately floated — with a catch, because an unhandled
    // rejection here would end the process (the defect fixed across the adapters in #41).
    void saveCreds().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[whatsapp-baileys] could not persist credentials: ${message}\n`);
    });
  });

  return socket;
}
