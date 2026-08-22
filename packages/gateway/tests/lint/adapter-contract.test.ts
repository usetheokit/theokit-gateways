/**
 * Lint test — cross-adapter contract invariants that no single package can see.
 *
 * Ten adapters implement the same contract in ten repositories of code. When one
 * of them quietly diverges, every test in that package still passes, because a
 * package's tests only ever compare it against itself. That is exactly how two
 * defects shipped:
 *
 * - Email and Teams returned an unsubscribe with no handler-identity guard. The
 *   other eight had `if (this.handler === handler)`. The sequence that breaks —
 *   `onInbound(A)` then `onInbound(B)` then A's stale unsubscribe — silently
 *   deafened the gateway, and only two of ten packages tested unsubscribe at
 *   all, neither in that order.
 * - WhatsApp's `connect()` had no connected-guard, so calling it twice opened
 *   two live sessions. Its own test asserted `connectCalls === 2` and called
 *   that idempotent.
 *
 * Behavioural tests for both now live in the packages that had the bugs. This
 * file exists for the divergence CLASS: it reads every adapter's source and
 * fails when one stops matching its nine siblings. It is a structural gate, in
 * the same spirit as `no-ptbr.test.ts`, and it is honest about that — it proves
 * the guard is present in the source, not that it behaves correctly. The
 * per-package tests prove the behaviour; this one prevents a silent drift that
 * no per-package test can be asked to notice.
 *
 * @internal
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGES_DIR = join(__dirname, "..", "..", "..");

/** Every `gateway-*` package that ships a platform adapter. */
async function adapterSources(): Promise<Array<{ pkg: string; source: string }>> {
  const entries = await readdir(PACKAGES_DIR, { withFileTypes: true });
  const out: Array<{ pkg: string; source: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("gateway-")) continue;
    const path = join(PACKAGES_DIR, entry.name, "src", "adapter.ts");
    try {
      out.push({ pkg: entry.name, source: await readFile(path, "utf8") });
    } catch {
      // A gateway-* package without src/adapter.ts is not an adapter package.
    }
  }
  return out.sort((a, b) => a.pkg.localeCompare(b.pkg));
}

/**
 * The `{ … }` block starting at `open`, by brace matching.
 *
 * A fixed-size window was tried first and could not fail: 700 characters from `onInbound`
 * reaches into the NEXT method, and that method's own guard satisfied the check. Every
 * masking defect in this repository has had this shape — one construct passing on the
 * strength of a neighbour.
 */
function blockAt(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  return code.slice(open);
}

/**
 * Every `.ts` under each adapter package's `src/`, kept SEPARATE by path.
 *
 * `adapterPackageSources()` concatenates a package's tree into one string, which is right for
 * asking "does this package do X somewhere" and wrong for asking "does every declaration of X do
 * it" — one compliant sibling makes the whole package pass. That is how three WhatsApp backends
 * came to have one guard between them.
 */
async function adapterSourceFiles(): Promise<Array<{ path: string; source: string }>> {
  const out: Array<{ path: string; source: string }> = [];
  for (const { pkg } of await adapterSources()) {
    const root = join(PACKAGES_DIR, pkg, "src");
    for (const file of await readdir(root, { recursive: true, withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".ts")) continue;
      const full = join(file.parentPath, file.name);
      out.push({ path: `${pkg}/${relative(root, full)}`, source: await readFile(full, "utf8") });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Every `.ts` under an adapter package's `src/`, concatenated per package.
 *
 * `adapterSources()` reads `src/adapter.ts` alone, which is where most of the contract lives. It is
 * not where all of it lives: `gateway-whatsapp` puts its inbound boundary in `src/backend/web` and
 * `src/backend/cloud`, so an invariant checked only against `adapter.ts` would report it as an
 * offender for code it does have, one directory over.
 */
async function adapterPackageSources(): Promise<Array<{ pkg: string; source: string }>> {
  const out: Array<{ pkg: string; source: string }> = [];
  for (const { pkg } of await adapterSources()) {
    const root = join(PACKAGES_DIR, pkg, "src");
    const files = await readdir(root, { recursive: true, withFileTypes: true });
    const parts: string[] = [];
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".ts")) continue;
      parts.push(await readFile(join(file.parentPath, file.name), "utf8"));
    }
    out.push({ pkg, source: parts.join("\n") });
  }
  return out;
}

/**
 * The source with comments removed.
 *
 * A gate that greps raw source is answered by prose. The first draft of the `empty_text` invariant
 * below passed against a deliberately reverted adapter, because the window it read was filled by
 * the comment explaining the very rule it was checking — the vacuous-gate failure this file's
 * header already warns about, reproduced by the file itself. Everything these invariants assert is
 * about code, so comments are removed before asking.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Why `sendMessage` fails the empty-text-first rule, or `undefined` when it does not.
 *
 * Positions are compared in the method's own code, comments removed, so the check answers to what
 * the adapter does rather than to what a comment near it says.
 */
function emptyTextGuardVerdict(source: string): string | undefined {
  const code = withoutComments(source);
  const start = code.indexOf("sendMessage(out: OutboundMessage)");
  if (start === -1) return undefined;
  const body = code.slice(start, start + 800);
  const emptyAt = body.indexOf("empty_text");
  const guardAt = body.search(/this\.connected|this\.\w+ === undefined/);
  if (emptyAt === -1) return "no empty_text guard";
  if (guardAt !== -1 && guardAt < emptyAt) return "state guard precedes empty_text";
  return undefined;
}

describe("cross-adapter contract", () => {
  it("identity-guards EVERY handler unsubscribe, in every file that declares one", async () => {
    // Per-declaration, not per-package. The package-level version of this check passed
    // `gateway-whatsapp` on the strength of its adapter while two of its three backends —
    // both public exports of the exported `WhatsAppBackend` interface — returned unsubscribes
    // with no guard at all. A consumer holding one directly hit `onInbound(A)` →
    // `onInbound(B)` → `A.off()` and went silent, with no error and nothing in a log.
    // `[^)]*` was the first attempt and matched NOTHING: every one of these declarations types
    // its parameter as a function, so the first `)` belongs to the inner signature. The gate ran
    // green over zero declarations — which is why it is verified below by counting them.
    const declaration =
      /on(?:Inbound|StatusReceipt)\s*\(\s*handler\s*:[\s\S]{0,200}?\)\s*:\s*\(\)\s*=>\s*void\s*\{/g;
    const offenders: string[] = [];
    let declarations = 0;
    for (const { path, source } of await adapterSourceFiles()) {
      const code = withoutComments(source);
      for (const found of code.matchAll(declaration)) {
        declarations += 1;
        const body = blockAt(code, found.index + found[0].length - 1);
        // Which field this method stores the handler in — read from the code rather than
        // assumed, so the guard is checked against the SAME field and a sibling's guard on a
        // different one cannot stand in for it.
        const stored = /this\.(\w+)\s*=\s*handler\s*;/.exec(body)?.[1];
        const guarded =
          stored !== undefined &&
          new RegExp(`if\\s*\\(\\s*this\\.${stored}\\s*===\\s*handler\\s*\\)`).test(body);
        if (!guarded) offenders.push(`${path}: ${found[0].slice(0, 24)}…`);
      }
    }
    // Counted, not guessed: 17 implementations across the ten adapters and WhatsApp's three
    // backends. A looser scan finds 19 — the extra two are the `WhatsAppBackend` interface's own
    // declarations, which end in `;` and correctly have no body to guard.
    //
    // The floor exists because the first version of this regex used `[^)]*` and matched ZERO:
    // every one of these types its parameter as a function, so the first `)` closes the inner
    // signature. The test ran green over an empty set and reported a contract it never checked.
    // Adding an adapter should make someone look here; that is the right kind of friction.
    expect(declarations).toBeGreaterThanOrEqual(17);
    expect(offenders).toEqual([]);
  });

  it("finds every adapter package", async () => {
    // If this drops to a handful, the glob broke and the assertions below became
    // vacuous — the failure mode a tree-scanning gate has to guard against.
    const sources = await adapterSources();
    expect(sources.length).toBeGreaterThanOrEqual(10);
  });

  it("guards every returned unsubscribe on handler identity", async () => {
    // Two weaknesses an audit measured, both fixed here. The source was read with comments
    // intact, so commenting the guard out passed while deleting it failed — the gate detected
    // removal, not disablement, which is the shape this file's own docblock says was already
    // found once in `empty_text`. And the guard alone was enough: an identity check with an
    // empty body satisfied it. The clearing assignment is now part of the pattern, because a
    // guard that clears nothing is the defect wearing the fix's shape.
    const offenders: string[] = [];
    for (const { pkg, source } of await adapterSources()) {
      const code = withoutComments(source);
      // The handler field is named `handler` in some adapters and
      // `inboundHandler` in others; both spellings are accepted.
      // The exemption that used to sit here is gone. It whitelisted WhatsApp on the grounds
      // that unsubscribing "through the backend handle" was "a different mechanism with the
      // same guarantee". Measured: that mechanism had NO guard — a stale `off()` tore down
      // whoever had subscribed last and left the gateway silent. The one adapter the gate
      // excused was the one adapter carrying the defect, which is what an exemption written
      // from a reading of the code rather than a test of it will eventually always be.
      const guarded =
        /if\s*\(\s*this\.(inboundH|h)andler\s*===\s*handler\s*\)\s*\{?\s*this\.\1andler\s*=\s*undefined\s*;/.test(
          code,
        );
      if (!guarded) offenders.push(pkg);
    }
    expect(offenders).toEqual([]);
  });

  it("guards every connect() against opening a second session", async () => {
    // This accepted `if (this.<anything>` — any field, any body. An adapter could satisfy it
    // with `if (this.token.length === 0) this.token = this.token;` and open two live sessions.
    // Measured across all ten: every one guards on `this.connected` and RETURNS. Requiring the
    // return is what separates a guard from a token sequence, and requiring the real field name
    // is honest rather than permissive — a new adapter that guards differently should have to
    // come here and say so.
    const offenders: string[] = [];
    for (const { pkg, source } of await adapterSources()) {
      const code = withoutComments(source);
      const at = code.indexOf("async connect(");
      if (at === -1) continue;
      const head = code.slice(at, at + 400);
      if (!/if\s*\(\s*this\.connected\b[^)]*\)\s*\{?\s*return\b/.test(head)) offenders.push(pkg);
    }
    expect(offenders).toEqual([]);
  });
  it("names a throwing handler as the handler's failure, in every adapter", async () => {
    // A handler is user code and may throw. Two adapters discarded that rejection with `void`, and
    // under Node 22's default an unhandled rejection ends the process: one message killed the bot
    // on Teams and on WhatsApp-web. Two more contained it but reported it as a platform error
    // ("client error", "bot error"), sending anyone debugging their own handler to discord.js and
    // grammy. Eight of ten already logged it correctly; the divergence is what this catches (#41).
    const offenders: string[] = [];
    for (const { pkg, source } of await adapterPackageSources()) {
      // `gateway-email` serialises dispatch through a queue and names it "dispatch error"; the
      // guarantee — contained, logged, delivery continues — is the same one.
      if (!/handler threw|dispatch error/.test(withoutComments(source))) offenders.push(pkg);
    }
    expect(offenders).toEqual([]);
  });

  it("never launches a user callback with a bare `void`", async () => {
    // `void promise` reads as "I am not waiting". What it tells the runtime is "I am not handling
    // the error", and that is the exact line that took the process down in two adapters. A
    // discarded promise at a platform boundary must carry its own `.catch`.
    const offenders: string[] = [];
    for (const { pkg, source } of await adapterPackageSources()) {
      // `void this.…` was the shape the first two offenders had. A third backend floated a
      // callback held in a local — `void handler(event)` — and the gate did not see it, while
      // a test in that package asserted this invariant covered it. Any floated call counts.
      for (const statement of withoutComments(source).matchAll(
        /\bvoid\s+[A-Za-z_$][\w$.?]*\([\s\S]{0,600}?;/g,
      )) {
        if (!statement[0].includes(".catch("))
          offenders.push(`${pkg}: ${statement[0].slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
  it("checks empty text before anything else in sendMessage", async () => {
    // The contract states it without a condition: empty text returns `empty_text`. Slack checked
    // the connection first, so one adapter answered `not_connected` to the call that answered
    // `empty_text` on the other nine — and code branching on the code to separate a caller's bad
    // input from an unavailable transport took the wrong branch on exactly one platform (#42).
    // Input first, transport second, is also what rules/error-handling.md § 2 asks for.
    const offenders = (await adapterSources())
      .map(({ pkg, source }) => ({ pkg, verdict: emptyTextGuardVerdict(source) }))
      .filter((row) => row.verdict !== undefined)
      .map((row) => `${row.pkg}: ${row.verdict}`);
    expect(offenders).toEqual([]);
  });
});
