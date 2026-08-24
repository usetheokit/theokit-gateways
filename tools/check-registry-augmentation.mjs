#!/usr/bin/env node
// Registry-augmentation gate — raised by B-008's second review.
//
// `PlatformEventRegistry` is extended by packages we do not control, through `declare module`. The
// guard that decides what may join lives in `packages/gateway/src/types/message-event.ts`, and the
// unit suite asserts it in isolation: `Registered<K, T>` given a hostile T returns `never`. That is
// necessary and it is not sufficient, because both defects this gate exists for lived in the
// COMPOSITION rather than in the guard — in what `keyof` yields and what a mapped type preserves:
//
//   * `{ [key: string]: BaseMessageEvent }` is a legal augmentation, since every variant is
//     assignable to the base. `keyof` then yields `string | number`, and indexing the mapped type
//     by that produced `never` for BOTH the union and the platform name. A hostile entry did not
//     fail to join — it annihilated the union, and every first-party narrowing site failed with
//     `TS2339: Property 'telegram' does not exist on type 'never'`.
//
//   * `signal?: SomeEvent` — a shape an author writes by accident — kept its optional modifier
//     through the homomorphic mapping and injected `undefined` into the union, so a plain
//     `switch (event.platform)` failed with `TS18048: 'e' is possibly 'undefined'`.
//
// Neither is reachable from a test inside this repository. A `declare module` applies to the whole
// compilation, so a hostile augmentation written in `tests/` poisons the package's own typecheck
// instead of being observed. Each fixture therefore gets its own tsconfig and its own `tsc` run.
//
// The gate compiles against `packages/gateway/dist/index.d.ts` — the declaration a consumer
// receives — and not against our sources, for the same reason the augmentation test lives in
// `integration/`: the barrel decides what a third party can even name.
//
// Deliberately NOT skipped when `dist/` is missing. A gate whose green can mean "there was nothing
// to check" reports an absence it never checked.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LABEL = "registry-augmentation";
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DTS = join(ROOT, "packages", "gateway", "dist", "index.d.ts");

/**
 * Each case is one augmentation a third party could write, plus what must remain true afterwards.
 *
 * `expect` is always `survives`: a hostile entry must be EXCLUDED, never fatal. A case that fails
 * here means an outsider can break first-party consumers by installing a package.
 */
const CASES = [
  { name: "well-formed", body: `signal: Ev<"signal">;` },
  { name: "optional-member", body: `signal?: Ev<"signal">;` },
  { name: "string-index-signature", body: `[key: string]: BaseMessageEvent;` },
  { name: "readonly-index-signature", body: `readonly [key: string]: BaseMessageEvent;` },
  { name: "number-index-signature", body: `[key: number]: BaseMessageEvent;` },
  { name: "any-value", body: `sloppy: any;` },
  { name: "unknown-value", body: `mystery: unknown;` },
  { name: "never-value", body: `nothing: never;` },
  { name: "base-event-value", body: `signal: BaseMessageEvent;` },
  { name: "key-literal-mismatch", body: `signal: Ev<"signl">;` },
  { name: "half-valid-union", body: `half: Ev<"half"> | { readonly nonsense: true };` },
  { name: "function-value", body: `fn: () => void;` },
];

/**
 * The probe every case shares.
 *
 * It exercises the COMPOSITION, not the guard: a first-party `switch` that must keep narrowing, an
 * assertion that the union was not annihilated, and one that `undefined` never entered it. Those
 * three are exactly what the two measured defects broke.
 */
function probe(body) {
  return `import type { MessageEvent, PlatformName, BaseMessageEvent } from "@theokit/gateway";

type Ev<P extends string> = Omit<BaseMessageEvent, "platform"> & { readonly platform: P };
type Exact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

declare module "@theokit/gateway" {
  interface PlatformEventRegistry { ${body} }
}

// First-party narrowing must survive whatever the augmentation did.
export function route(event: MessageEvent): string | number {
  switch (event.platform) {
    case "telegram":
      return event.telegram.chatId;
    case "discord":
      return event.discord.channelId;
    default:
      return event.text;
  }
}

// The union must not have been annihilated, and must not admit \`undefined\`.
export const notAnnihilated: Exact<PlatformName, never> = false;
export const noUndefined: Exact<Extract<MessageEvent, undefined>, never> = true;
`;
}

const TSCONFIG = {
  compilerOptions: {
    strict: true,
    noUncheckedIndexedAccess: true,
    noEmit: true,
    module: "esnext",
    moduleResolution: "bundler",
    skipLibCheck: true,
    paths: { "@theokit/gateway": [DTS] },
  },
  include: ["probe.ts"],
};

/** Compile one augmentation in its own program. Returns the compiler output, or null when clean. */
function compileCase(testCase) {
  const dir = mkdtempSync(join(tmpdir(), `registry-aug-${testCase.name}-`));
  try {
    writeFileSync(join(dir, "probe.ts"), probe(testCase.body));
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(TSCONFIG, null, 2));
    execFileSync("npx", ["tsc", "-p", join(dir, "tsconfig.json")], {
      cwd: ROOT,
      stdio: "pipe",
      encoding: "utf8",
    });
    return null;
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Print the failures and exit non-zero. Never called when the battery is clean. */
function reportFailures(failures) {
  console.error(
    `[${LABEL}] x ${failures.length} augmentation(s) broke first-party consumers instead of being excluded:`,
  );
  for (const failure of failures) {
    console.error(`\n  ${failure.name} — \`${failure.body}\``);
    for (const line of failure.output.split("\n").slice(0, 3)) {
      console.error(`    ${line}`);
    }
  }
  console.error(
    `\n[${LABEL}] FAIL — a third party can break consumers who never opted in. See` +
      " docs/adr/0002-platform-event-registry.md.",
  );
  process.exit(1);
}

/** Refuse to run against a missing artifact: a green that means "nothing was checked" is a lie. */
function requireBuiltDeclaration() {
  try {
    statSync(DTS);
  } catch {
    console.error(`[${LABEL}] FAIL — ${DTS} is missing. Run \`pnpm build\` first.`);
    process.exit(1);
  }
}

function main() {
  requireBuiltDeclaration();

  const failures = [];
  for (const testCase of CASES) {
    const output = compileCase(testCase);
    if (output !== null) {
      failures.push({ name: testCase.name, body: testCase.body, output });
    }
  }

  if (failures.length > 0) {
    reportFailures(failures);
  }

  console.log(
    `[${LABEL}] PASS — ${CASES.length} augmentation shapes, none fatal to first parties.`,
  );
}

main();
