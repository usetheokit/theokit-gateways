// The distinction this file exists to pin is the one the gate turns on: a type is not a value.
// Comparing raw export lists between a `.d.ts` and its `.js` reported 78 divergences on this
// repository, every one of them an interface or type alias that legitimately has no runtime
// existence. A gate that fires 78 times on a clean tree is not strict, it is broken.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { compareExports, valueExportsOf } from "../lib/value-exports.mjs";

let dir;

function withFiles(files) {
  dir = mkdtempSync(join(tmpdir(), "parity-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("valueExportsOf", () => {
  it("counts a class, a function and a const as values", () => {
    const at = withFiles({
      "m.d.ts": [
        "export declare class Adapter {}",
        "export declare function send(): void;",
        "export declare const LIMIT: number;",
      ].join("\n"),
    });

    expect(valueExportsOf(join(at, "m.d.ts"), false)).toEqual(
      new Set(["Adapter", "send", "LIMIT"]),
    );
  });

  it("does NOT count an interface or a type alias", () => {
    // The whole reason the gate can run at all. Without this the clean tree reports 78 failures.
    const at = withFiles({
      "m.d.ts": [
        "export interface Options { a: string }",
        "export type Name = string;",
        "export declare const real: number;",
      ].join("\n"),
    });

    expect(valueExportsOf(join(at, "m.d.ts"), false)).toEqual(new Set(["real"]));
  });

  it("follows an alias to decide, rather than judging the re-export itself", () => {
    // A re-export's own flags say nothing about what it points at, so an aliased VALUE must count
    // and an aliased TYPE must not.
    const at = withFiles({
      "inner.d.ts": ["export declare class Real {}", "export interface Shape { a: string }"].join(
        "\n",
      ),
      "m.d.ts": 'export { Real, type Shape } from "./inner.js";',
    });

    expect(valueExportsOf(join(at, "m.d.ts"), false)).toEqual(new Set(["Real"]));
  });

  it("reads the runtime file too, so the two sides are asked the same question", () => {
    const at = withFiles({
      "m.js": ["export class Adapter {}", "export const LIMIT = 1;"].join("\n"),
    });

    expect(valueExportsOf(join(at, "m.js"), true)).toEqual(new Set(["Adapter", "LIMIT"]));
  });

  it("returns undefined for a file the compiler cannot read", () => {
    // The caller must be able to tell "nothing exported" from "nothing read". An empty set compared
    // against another empty set is a green run that measured nothing.
    expect(valueExportsOf(join(tmpdir(), "does-not-exist-9f3a.d.ts"), false)).toBeUndefined();
  });
});

describe("compareExports", () => {
  it("reports a value the runtime has and the declaration lacks", () => {
    // A consumer cannot import this in TypeScript at all, against a package whose `.js` plainly
    // has it. In this repository the usual cause is loud (the build fails), but it is silent in any
    // repository whose barrels use `export *`.
    const result = compareExports(new Set(["kept"]), new Set(["kept", "stripped"]));

    expect(result).toEqual({ missingTypes: ["stripped"], missingRuntime: [] });
  });

  it("reports a value the declaration has and the runtime lacks", () => {
    // The worse direction: it compiles, and it is `undefined` when the program runs — past every
    // static gate, into the consumer's production.
    const result = compareExports(new Set(["kept", "phantom"]), new Set(["kept"]));

    expect(result).toEqual({ missingTypes: [], missingRuntime: ["phantom"] });
  });

  it("reports nothing when the two agree", () => {
    expect(compareExports(new Set(["a", "b"]), new Set(["b", "a"]))).toEqual({
      missingTypes: [],
      missingRuntime: [],
    });
  });

  it("sorts each side, so a report does not reshuffle between runs", () => {
    const result = compareExports(new Set(), new Set(["c", "a", "b"]));

    expect(result.missingTypes).toEqual(["a", "b", "c"]);
  });
});
