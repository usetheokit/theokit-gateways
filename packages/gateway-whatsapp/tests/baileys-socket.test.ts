/**
 * `createBaileysSocket` — the one place this backend touches the real library.
 *
 * It had no tests at all. That is the sharpest possible irony in this package: the module's own
 * header cites B-002 — the `web` bridge that shipped unable to start, for months, behind a
 * friendly "not installed" message that was false — as the reason its import shape is written the
 * way it is. The lesson was that a peer-loading path exercised by nothing is a path that breaks in
 * silence, and it was then applied everywhere except here.
 *
 * The seam that makes this testable is already documented at `BaileysSocketOptions.specifier`
 * ("Tests point it at a stub; production never sets it") and, until now, no test did. These run
 * with `baileys` absent, like every other test in this package.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBaileysSocket } from "../src/backend/baileys/socket.js";
import { ConfigurationError } from "../src/errors.js";

/**
 * What the stub modules record on the global object.
 *
 * A stub is loaded by URL through the `specifier` seam, so it cannot be imported by the test and
 * asked directly — the global is the only channel back. Typed here rather than cast at each use,
 * so a rename breaks the compile instead of silently reading `undefined`.
 */
interface StubChannel {
  __wired?: [string, (payload: unknown) => void][];
  __saved?: number;
  __config?: Record<string, unknown>;
}

const shared = globalThis as unknown as StubChannel;

let dir: string | undefined;

/** Write a stub module standing in for `baileys`, and return a specifier that resolves to it. */
function stubModule(source: string): string {
  dir = mkdtempSync(join(tmpdir(), "baileys-stub-"));
  const file = join(dir, "stub.mjs");
  writeFileSync(file, source);
  return pathToFileURL(file).href;
}

/** A stub exporting everything the factory needs, with the members the test wants to observe. */
const COMPLETE_STUB = `
export const calls = [];
export function makeWASocket(config) {
  calls.push(config);
  return { ev: { on: (event, listener) => { (globalThis.__wired ??= []).push([event, listener]); } },
           sendMessage: async () => ({ key: { id: "x" } }) };
}
export async function useMultiFileAuthState(dir) {
  return { state: { creds: { dir } }, saveCreds: async () => { (globalThis.__saved ??= 0); globalThis.__saved += 1; } };
}
export async function fetchLatestBaileysVersion() { return { version: [2, 3000, 1] }; }
`;

afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  shared.__wired = undefined;
  shared.__saved = undefined;
  shared.__config = undefined;
});

describe("createBaileysSocket — the peer boundary", () => {
  it("names the package when it is not installed, instead of leaking ERR_MODULE_NOT_FOUND", async () => {
    // The B-002 shape: a consumer who has not installed an optional peer must be told which
    // package to add, not handed the module loader's error.
    await expect(
      createBaileysSocket({ sessionDir: "/tmp/x", specifier: "baileys-does-not-exist" }),
    ).rejects.toMatchObject({ code: "peer_missing" });
  });

  it("names the missing export when the peer is installed but incompatible", async () => {
    // This is the half B-002 actually got wrong. The `try/catch` guards the package being
    // ABSENT; a package present with the wrong surface sailed past it and failed later,
    // somewhere else, as something else.
    const specifier = stubModule(`export const somethingElse = 1;`);

    await expect(createBaileysSocket({ sessionDir: "/tmp/x", specifier })).rejects.toMatchObject({
      code: "peer_incompatible",
    });
    await expect(createBaileysSocket({ sessionDir: "/tmp/x", specifier })).rejects.toThrow(
      /makeWASocket/,
    );
  });

  it("reads the API off the default export before the namespace", async () => {
    // Baileys ships CJS. Under Node's interop the named exports may only exist on `default`,
    // which is precisely how the `web` bridge came to believe a present library was absent.
    const specifier = stubModule(`
      export default {
        makeWASocket: (config) => ({ ev: { on: () => {} }, sendMessage: async () => undefined, __fromDefault: true }),
        useMultiFileAuthState: async () => ({ state: {}, saveCreds: async () => {} }),
      };
    `);

    const socket = await createBaileysSocket({ sessionDir: "/tmp/x", specifier });

    expect((socket as { __fromDefault?: boolean }).__fromDefault).toBe(true);
  });

  it("connects without fetchLatestBaileysVersion, which is optional", async () => {
    // Absent, we still connect — Baileys falls back to its bundled default, a worse guess but
    // not a failure. Treating it like the required members would refuse a working install.
    const specifier = stubModule(`
      export function makeWASocket(config) { globalThis.__config = config; return { ev: { on: () => {} }, sendMessage: async () => undefined }; }
      export async function useMultiFileAuthState() { return { state: {}, saveCreds: async () => {} }; }
    `);

    await createBaileysSocket({ sessionDir: "/tmp/x", specifier });

    expect(shared.__config).toBeDefined();
    expect("version" in (shared.__config ?? {})).toBe(false);
  });
});

describe("createBaileysSocket — the hygiene settings (ADR D322)", () => {
  it("passes each setting the ADR justifies, and the fetched protocol version", async () => {
    // Not style. `markOnlineOnConnect: false` stops the account reading as permanently online,
    // which suppresses push notifications on the owner's real phone; `syncFullHistory: false`
    // stops a connect pulling the whole history; `printQRInTerminal: false` keeps a library out
    // of the host's stdout; and a stale protocol version is refused by the server outright.
    const specifier = stubModule(COMPLETE_STUB);

    await createBaileysSocket({ sessionDir: "/tmp/sess", specifier });
    const config = (await import(specifier)).calls[0];

    expect(config).toMatchObject({
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      version: [2, 3000, 1],
    });
    expect(config.browser).toEqual(["theokit-gateway", "chrome", "1.0.0"]);
    expect(config.auth).toEqual({ creds: { dir: "/tmp/sess" } });
  });
});

describe("createBaileysSocket — pairing and credentials", () => {
  /** Fire one of the listeners the factory registered on the socket. */
  function emit(event: string, payload: unknown): void {
    for (const [name, listener] of shared.__wired ?? []) {
      if (name === event) listener(payload);
    }
  }

  it("writes the QR to stderr when the caller gave it nowhere else to go", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const specifier = stubModule(COMPLETE_STUB);

    await createBaileysSocket({ sessionDir: "/tmp/x", specifier });
    emit("connection.update", { qr: "2@somecode" });

    const written = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("2@somecode");
    expect(written).toContain("Linked devices");
    stderr.mockRestore();
  });

  it("ignores a connection update carrying no QR", async () => {
    const sink: string[] = [];
    const specifier = stubModule(COMPLETE_STUB);

    await createBaileysSocket({
      sessionDir: "/tmp/x",
      specifier,
      onQr: (qr) => void sink.push(qr),
    });
    emit("connection.update", { connection: "connecting" });
    emit("connection.update", { qr: "" });
    emit("connection.update", { qr: "2@real" });

    expect(sink).toEqual(["2@real"]);
  });

  it("persists credentials when the library reports them changed", async () => {
    // This is what makes a pairing survive a restart. Nothing exercised it.
    const specifier = stubModule(COMPLETE_STUB);

    await createBaileysSocket({ sessionDir: "/tmp/x", specifier });
    emit("creds.update", {});
    await new Promise((r) => setTimeout(r, 10));

    expect(shared.__saved).toBe(1);
  });

  it("reports a credential-save failure instead of ending the process", async () => {
    // The save is floated because the library's callback is synchronous, and a floated
    // rejection is an unhandled one — which under Node 22 terminates the process. That is the
    // defect fixed across the adapters in #41, and here it would fire on a disk that filled up.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const specifier = stubModule(`
      export function makeWASocket() { return { ev: { on: (e, l) => { (globalThis.__wired ??= []).push([e, l]); } }, sendMessage: async () => undefined }; }
      export async function useMultiFileAuthState() {
        return { state: {}, saveCreds: async () => { throw new Error("ENOSPC: no space left on device"); } };
      }
    `);

    await createBaileysSocket({ sessionDir: "/tmp/x", specifier });
    emit("creds.update", {});
    await new Promise((r) => setTimeout(r, 10));

    const written = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("could not persist credentials");
    expect(written).toContain("ENOSPC");
    stderr.mockRestore();
  });
});

describe("createBaileysSocket — the error type", () => {
  it("raises this package's ConfigurationError, not a bare Error", async () => {
    // A caller branches on the structured `code`; a bare Error forces string matching on a
    // message, which is what every adapter in this repository stopped doing.
    const raised = await createBaileysSocket({
      sessionDir: "/tmp/x",
      specifier: "baileys-does-not-exist",
    }).then(
      () => undefined,
      (err: unknown) => err,
    );

    expect(raised).toBeInstanceOf(ConfigurationError);
    // `toBeInstanceOf` alone is what `rules/testing.md` § 4.1 calls half a negative case: it proves
    // the type and not the diagnostic, and the diagnostic is the whole reason for a typed error.
    // Both were free to be emptied — measured, mutating the name and the package tag killed no
    // test — and an error reading `: ` in a log is worse than a bare Error, not better.
    expect((raised as Error).name).toBe("ConfigurationError");
    // This watches the message THIS call site writes, not the constructor's prefix — every call
    // site passes an explicit `message`, so the prefix argument is never reached from here. The
    // prefix has its own test in errors.test.ts.
    expect((raised as Error).message, "the error does not say which package raised it").toContain(
      "gateway-whatsapp",
    );
  });
});
