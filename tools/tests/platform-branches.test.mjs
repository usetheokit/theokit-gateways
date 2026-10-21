// The per-platform branch detector (FR-009, NFR-004; alignment AC-011).
//
// One sample per spelling, each asserting an exact count: a detector that over-counts inflates the
// "before" fixture as surely as one that under-counts flatters the "after" one. The samples are
// parsed, never run, so they reference names they do not define.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { countPlatformBranches, PLATFORM_NAMES } from "../lib/platform-branches.mjs";

const ts = createRequire(import.meta.url)("typescript");

const count = (source) => countPlatformBranches(source).count;
const kinds = (source) => countPlatformBranches(source).sites.map((s) => s.kind);

const TELEGRAM_IMPORT =
  'import { TelegramAdapter, telegramChannel } from "@theokit/gateway-telegram";';
const LINE_IMPORT =
  'import { LineAdapter, lineChannel, lineEventToMessageEvent, verifyLineSignature } from "@theokit/gateway-line";';

/** The union `PlatformName` resolves to, read by the compiler from the core's own source. */
function platformNameUnion() {
  const file = fileURLToPath(
    new URL("../../packages/gateway/src/types/message-event.ts", import.meta.url),
  );
  const program = ts.createProgram([file], {
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const source = program.getSourceFile(file);
  const checker = program.getTypeChecker();
  const alias = source.statements.find(
    (s) => ts.isTypeAliasDeclaration(s) && s.name.text === "PlatformName",
  );
  const type = checker.getTypeAtLocation(alias.name);
  const members = type.isUnion() ? type.types : [type];
  return members.map((t) => t.value).sort();
}

describe("countPlatformBranches", () => {
  it("counts a platform adapter constructed from a platform package", () => {
    expect(count(`${TELEGRAM_IMPORT}\nconst a = new TelegramAdapter({ token });`)).toBe(1);
  });

  it("counts an import from a hyphenated platform package", () => {
    const source = [
      'import { GoogleChatAdapter } from "@theokit/gateway-google-chat";',
      "new GoogleChatAdapter(options);",
    ].join("\n");
    expect(count(source)).toBe(1);
    const fromSubpath = [
      'import { verifyGoogleChatToken } from "@theokit/gateway-google-chat/verify";',
      "verifyGoogleChatToken(header);",
    ].join("\n");
    expect(count(fromSubpath)).toBe(1);
  });

  it("does not count a hyphenated package that names no platform", () => {
    // The suffix maps to a key only when it names one: no hyphenated name is a platform by shape.
    expect(count('import { X } from "@theokit/gateway-acme-chat";\nnew X(o);')).toBe(0);
    expect(count('import { X } from "@theokit/gateway-google_chat";\nnew X(o);')).toBe(0);
  });

  it("counts a translator or verifier called from a platform package", () => {
    expect(count(`${LINE_IMPORT}\nverifyLineSignature(secret, body, header);`)).toBe(1);
    expect(count(`${LINE_IMPORT}\nconst e = lineEventToMessageEvent(raw);`)).toBe(1);
  });

  it("counts a platform-only adapter method call", () => {
    expect(count("a.dispatchWebhookBody(e);")).toBe(1);
    expect(count("const s = a.getChannelSecret();")).toBe(1);
    expect(count("a.getBot().on('x', h);")).toBe(1);
  });

  it("counts a comparison against a platform name in any quote style and either operand order", () => {
    const spellings = [
      'if (x.platform === "line") f();',
      'if (x.platform == "line") f();',
      "if ('telegram' === x.platform) f();",
      'if ("line" === p) f();',
      "if (p !== `line`) f();",
      "if (p != 'telegram') f();",
    ];
    for (const source of spellings) {
      expect(count(source), source).toBe(1);
    }
  });

  it("counts a comparison against a descriptor identity", () => {
    expect(count(`${LINE_IMPORT}\nif (d === lineChannel) f();`)).toBe(1);
  });

  it("counts a comparison against an identifier bound to a platform name", () => {
    expect(count('const L = "line";\nif (p === L) f();')).toBe(1);
  });

  it("counts Object.is against a platform name", () => {
    expect(count('if (Object.is(p, "line")) f();')).toBe(1);
    expect(kinds('Object.is(p, "line");')).toEqual(["comparison"]);
  });

  it("counts instanceof against a class from a platform package", () => {
    expect(count(`${LINE_IMPORT}\nif (x instanceof LineAdapter) f();`)).toBe(1);
  });

  it("counts a case label on a platform name", () => {
    expect(count('switch (p) { case "line": f(); break; default: g(); }')).toBe(1);
  });

  it("counts a membership call on a platform name", () => {
    expect(count('if (["line"].includes(p)) f();')).toBe(1);
    expect(count('if (p.localeCompare("line") === 0) f();')).toBe(1);
  });

  it("counts an indexed dispatch table keyed by a platform name", () => {
    expect(count("const h = ({ line: onLine })[p];")).toBe(1);
  });

  it("refuses a file it cannot parse", () => {
    expect(() => countPlatformBranches("const = ;", { fileName: "broken.ts" })).toThrow(
      "broken.ts:1: cannot parse: Variable declaration expected.",
    );
  });

  it("counts nested sites separately", () => {
    expect(count(`${LINE_IMPORT}\nverifyLineSignature(a.getChannelSecret(), b, h);`)).toBe(2);
  });

  it("counts a relative import as an unscannable site", () => {
    expect(count('import { h } from "./helper.js";\nh();')).toBe(1);
    expect(kinds('import { h } from "./helper.js";')).toEqual(["relative_import"]);
  });

  it("counts zero for a file that imports only descriptors and the core", () => {
    const source = [
      'import { createChannels, GatewayRunner } from "@theokit/gateway";',
      'import { telegramChannel } from "@theokit/gateway-telegram";',
      'import { lineChannel } from "@theokit/gateway-line";',
      "const descriptors = [telegramChannel, lineChannel];",
      "const byPlatform = new Map(descriptors.map((d) => [d.platform, d]));",
      "const { adapters } = createChannels(descriptors.map((descriptor) => ({ descriptor, config: config[descriptor.platform] })));",
      "const runner = new GatewayRunner({ adapters, handler, connectFailure: 'isolate' });",
      "const webhook = byPlatform.get(adapter.platform)?.webhook;",
    ].join("\n");
    expect(countPlatformBranches(source)).toEqual({ count: 0, sites: [] });
  });

  it("does not count a construction from the core", () => {
    expect(
      count(
        `${TELEGRAM_IMPORT}\nimport { GatewayRunner } from "@theokit/gateway";\nnew GatewayRunner(o);`,
      ),
    ).toBe(0);
  });

  it("records the line, kind and text of each site", () => {
    const { sites } = countPlatformBranches(
      `${TELEGRAM_IMPORT}\n\nconst a = new TelegramAdapter({ token });`,
    );
    expect(sites).toEqual([{ line: 3, kind: "construct", text: "new TelegramAdapter({ token })" }]);
  });

  it("counts a construction or call through a namespace import or a static member", () => {
    const source = [
      'import * as Line from "@theokit/gateway-line";',
      "new Line.LineAdapter(o);",
      "Line.verifyLineSignature(s, b, h);",
    ].join("\n");
    expect(kinds(source)).toEqual(["construct", "call"]);
    expect(kinds(`${LINE_IMPORT}\nLineAdapter.fromEnv();`)).toEqual(["call"]);
  });

  it("sees a platform name through as const, satisfies and a non-null assertion", () => {
    expect(count('if (p === ("line" as const)) f();')).toBe(1);
    expect(count('const L = "line" as const;\nif (p === L) f();')).toBe(1);
    expect(count("const h = ({ line: a } satisfies R)[p];")).toBe(1);
    expect(count("if (p === L!) f();\nconst L = 'line';")).toBe(1);
  });

  it("counts a relative re-export, dynamic import or require as unscannable", () => {
    expect(kinds('export { h } from "./helper.js";')).toEqual(["relative_import"]);
    expect(kinds('const m = await import("./helper.js");')).toEqual(["relative_import"]);
    expect(kinds('const m = require("./helper.js");')).toEqual(["relative_import"]);
  });

  it("counts a type-only relative import as unscannable, like any relative import", () => {
    expect(kinds('import type { T } from "./types.js";\nlet x: T;')).toEqual(["relative_import"]);
    expect(kinds('import { type T } from "./types.js";\nlet x: T;')).toEqual(["relative_import"]);
    expect(kinds('export type { T } from "./types.js";')).toEqual(["relative_import"]);
  });

  it("labels each site with its NFR-004 kind", () => {
    expect(kinds(`${LINE_IMPORT}\nverifyLineSignature(a.getChannelSecret(), b, h);`)).toEqual([
      "call",
      "platform_method",
    ]);
    expect(kinds("a.dispatchWebhookBody(e);")).toEqual(["platform_method"]);
    expect(kinds(`${LINE_IMPORT}\nx instanceof LineAdapter;`)).toEqual(["instanceof"]);
    expect(kinds('switch (p) { case "line": break; }')).toEqual(["comparison"]);
    expect(kinds('["line"].includes(p);')).toEqual(["membership"]);
    expect(kinds("({ line: h })[p];")).toEqual(["dispatch_table"]);
  });

  it("keeps its platform list equal to PlatformName", () => {
    expect([...PLATFORM_NAMES].sort()).toEqual(platformNameUnion());
    expect(PLATFORM_NAMES).toHaveLength(14);
  });
});
