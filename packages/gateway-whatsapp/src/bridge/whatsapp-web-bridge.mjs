#!/usr/bin/env node
/**
 * whatsapp-web.js subprocess bridge.
 *
 * Spawned by `WhatsAppWebBackend.connect()`. Speaks JSON-lines over stdio:
 *  - stdin  ← commands (`{ cmd: "send" | "shutdown", ... }`)
 *  - stdout → events (`{ event: "ready" | "message" | "send_ack" | "status" | "error", ... }`)
 *
 * The user MUST have `whatsapp-web.js` installed in their app (peer dep).
 *
 * MUST carry `whatsapp-web-bridge` literally in argv (EC-5 cmdline guard).
 *
 * Usage: node whatsapp-web-bridge.mjs --tag whatsapp-web-bridge --session <id>
 *
 * @internal
 */

import { createInterface } from "node:readline";

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

/**
 * Report a failure on the protocol the parent reads.
 *
 * `code` is what makes the report actionable by a machine. Without it the backend can only
 * substring-match the message, which is how `mapWhatsAppWebError` works and why every
 * startup failure landed on `unknown`.
 */
function emitError(message, code) {
  emit({ event: "error", message, ...(code !== undefined ? { code } : {}) });
}

const argv = process.argv.slice(2);

/** Value of a `--flag value` pair in argv, or undefined. */
function argOf(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/**
 * Where to load the WhatsApp Web client from.
 *
 * Injected as an argument rather than read from the environment. An env var is ambient: the
 * parent spawns without an explicit `env`, so the child inherits the host application's
 * whole environment, and any value sitting there would silently control an arbitrary
 * `import()` inside this process. An argument comes from the one caller that spawns us, and
 * every other seam in this repository has the same shape — `__appFactory`, `__imapFactory`,
 * `spawnFactory` — an injection point the parent controls rather than ambient state.
 */
const SPECIFIER = argOf("--specifier") ?? "whatsapp-web.js";

let Client;
let LocalAuth;
try {
  const mod = await import(SPECIFIER);
  // D315: read the API off the DEFAULT export, not off synthesised named bindings.
  //
  // `whatsapp-web.js/index.js` ends its `module.exports` object with a spread
  // (`...Constants`). `cjs-module-lexer` cannot statically analyse an object built that
  // way, so Node synthesises only some named exports — measured on 1.34.7, exactly
  // `Client`, while `LocalAuth`, `NoAuth` and `RemoteAuth` exist only on the default.
  // Destructuring the namespace therefore yielded `LocalAuth === undefined`, and the
  // process died at `new LocalAuth(...)` with a TypeError (B-002). The default export is
  // the whole `module.exports` value at runtime, whatever the lexer could prove.
  //
  // The `?? mod` fallback covers a true-ESM module, where there is no default to read.
  const api = mod.default ?? mod;
  Client = api.Client ?? mod.Client;
  LocalAuth = api.LocalAuth ?? mod.LocalAuth;
} catch (err) {
  // Absent and broken are different problems. Any throw used to yield "not installed", so a
  // nested missing dependency or a syntax error inside a package that IS installed sent the
  // consumer to install what they already had.
  if (err?.code === "ERR_MODULE_NOT_FOUND") {
    emitError(
      `${SPECIFIER} not installed in your app. Run \`pnpm add whatsapp-web.js\` to use the web backend. (${err?.message ?? err})`,
      "peer_missing",
    );
  } else {
    emitError(
      `${SPECIFIER} is installed but failed to load: ${err?.message ?? err}`,
      "peer_load_failed",
    );
  }
  process.exit(1);
}

// D316: a package that is PRESENT but does not expose what we need is a different failure
// from one that is absent, and it needs a different message. The `catch` above only sees an
// import that threw; a resolved module missing a member sails past it and surfaces thirteen
// lines later as an unhandled TypeError the parent cannot map to anything. Telling the
// consumer to run `pnpm add` for a package they already have is worse than saying nothing.
for (const [name, value] of [
  ["Client", Client],
  ["LocalAuth", LocalAuth],
]) {
  if (typeof value !== "function") {
    emitError(
      `${SPECIFIER} is installed but does not export ${name} as a constructor. ` +
        `Expected a function, got ${typeof value}. This usually means an incompatible version — ` +
        `the web backend expects the peer range declared in @theokit/gateway-whatsapp.`,
      "peer_incompatible",
    );
    process.exit(1);
  }
}

const sessionId = argOf("--session") ?? "default";

const client = new Client({
  authStrategy: new LocalAuth({ clientId: sessionId }),
  puppeteer: { headless: true, args: ["--no-sandbox"] },
});

client.on("qr", (qr) => {
  // QR is logged to stderr so the user can scan from terminal output.
  process.stderr.write(`\n[whatsapp-web bridge] Scan this QR with your WhatsApp app:\n${qr}\n\n`);
});

client.on("ready", () => {
  const phone = client.info?.wid?.user ?? "unknown";
  emit({ event: "ready", botPhone: phone });
});

client.on("message", (msg) => {
  try {
    emit({
      event: "message",
      msgId: msg.id?._serialized ?? `wa-${Date.now()}`,
      from: msg.from ?? "",
      body: msg.body ?? "",
      isGroup: typeof msg.from === "string" && msg.from.endsWith("@g.us"),
      chatId: msg.from ?? "",
      contactName: msg._data?.notifyName,
      timestamp: (msg.timestamp ?? Math.floor(Date.now() / 1000)) * 1000,
    });
  } catch (err) {
    emitError(`message handler failed: ${err?.message ?? err}`);
  }
});

client.on("message_ack", (msg, ack) => {
  // ack 1=sent, 2=delivered, 3=read, 4=played
  const statusMap = { 1: "sent", 2: "delivered", 3: "read" };
  const status = statusMap[ack];
  if (status === undefined) return;
  emit({
    event: "status",
    msgId: msg.id?._serialized ?? "",
    status,
    recipient: msg.to ?? msg.from ?? "",
    timestamp: Date.now(),
  });
});

client.on("auth_failure", (msg) => {
  emitError(`AUTHENTICATION_FAILURE: ${msg}`);
});

client.on("disconnected", (reason) => {
  emitError(`DISCONNECTED: ${reason}`);
});

/**
 * Close the browser and leave, under a deadline.
 *
 * The deadline is the point. `client.destroy()` closes Chromium, and while WhatsApp Web is still
 * loading it can wait forever — so an unbounded shutdown is a process that never exits. Racing it
 * against a timer means the browser is closed properly when that is possible and the bridge leaves
 * regardless, which is what a supervisor waiting on the exit is owed.
 */
let shuttingDown = false;
async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.race([
    client.destroy().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  process.exit(code);
}

/**
 * Own the termination signals.
 *
 * Measured 2026-08-30: without these, SIGTERM did not stop the bridge at all — the process stayed
 * up and eleven Chromium processes with it. puppeteer registers its own SIGTERM/SIGINT/SIGHUP
 * handlers by default, and registering ANY handler removes Node's terminate-on-signal default; the
 * bridge then inherited a shutdown that could hang and had no deadline of its own.
 *
 * Registering last wins for the exit: puppeteer's handler still runs and closes what it can, and
 * this one guarantees the process actually leaves.
 */
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    void shutdown(0);
  });
}

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch {
    return;
  }
  if (cmd?.cmd === "shutdown") {
    await shutdown(0);
  }
  if (cmd?.cmd === "send") {
    const msgId = cmd.msgId;
    try {
      const sent = await client.sendMessage(cmd.to, cmd.text);
      emit({
        event: "send_ack",
        msgId,
        success: true,
        wamid: sent?.id?._serialized,
      });
    } catch (err) {
      emit({
        event: "send_ack",
        msgId,
        success: false,
        error: err?.message ?? String(err),
      });
    }
  }
});

// Kick off the auth/login flow.
client.initialize().catch((err) => {
  emitError(`initialize failed: ${err?.message ?? err}`);
  process.exit(1);
});
