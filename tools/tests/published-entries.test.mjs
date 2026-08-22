// The multi-entry cases here have NO instance in this repository — every package publishes a single
// `.` today. They exist because the sibling repository `theokit-plugins` proved what the earlier
// hard-coded `dist/index.d.ts` assumption costs: eleven packages, eighteen declaration entries,
// eight of them subpaths, one of them at `dist/stripe.d.ts` rather than `dist/stripe/index.d.ts`.
// Ported unchanged, the gates there would have measured 11 of 18 and reported a number that reads as
// whole-package coverage.
//
// A gate cannot be trusted to start covering a shape the first time that shape appears in the repo.
// These tests are what make the claim true before there is anything here to prove it on.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { publishedEntries } from "../lib/published-entries.mjs";

let fixture;

/** A package directory with the given declaration files actually present on disk. */
function packageWith(files) {
  fixture = mkdtempSync(join(tmpdir(), "entries-"));
  for (const file of files) {
    const full = join(fixture, file);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "export {};\n");
  }
  return fixture;
}

afterEach(() => {
  if (fixture !== undefined) rmSync(fixture, { recursive: true, force: true });
  fixture = undefined;
});

describe("publishedEntries", () => {
  it("reads the single-entry shape every package here uses", () => {
    const dir = packageWith(["dist/index.d.ts"]);
    const meta = {
      name: "@scope/pkg",
      exports: { ".": { import: { types: "./dist/index.d.ts" } } },
    };

    expect(publishedEntries(meta, dir)).toEqual([
      { pkg: "@scope/pkg", specifier: "@scope/pkg", decl: join(dir, "./dist/index.d.ts") },
    ]);
  });

  it("finds every subpath, not just the root", () => {
    const dir = packageWith(["dist/index.d.ts", "dist/ui.d.ts", "dist/server/index.d.ts"]);
    const meta = {
      name: "@scope/pkg",
      exports: {
        ".": { import: { types: "./dist/index.d.ts" } },
        // Deliberately NOT `./dist/ui/index.d.ts` — a real package published exactly this shape,
        // and a resolver that assumes the directory form finds nothing.
        "./ui": { import: { types: "./dist/ui.d.ts" } },
        "./server": { import: { types: "./dist/server/index.d.ts" } },
      },
    };

    expect(publishedEntries(meta, dir).map((row) => row.specifier)).toEqual([
      "@scope/pkg",
      "@scope/pkg/ui",
      "@scope/pkg/server",
    ]);
  });

  it("takes both module formats when a package publishes both", () => {
    // The defect behind #29 appeared identically in `.d.ts` and `.d.cts`; checking one would leave
    // half the consumers unprotected.
    const dir = packageWith(["dist/index.d.ts", "dist/index.d.cts"]);
    const meta = {
      name: "@scope/pkg",
      exports: {
        ".": { import: { types: "./dist/index.d.ts" }, require: { types: "./dist/index.d.cts" } },
      },
    };

    expect(publishedEntries(meta, dir)).toHaveLength(2);
  });

  it("falls back to the legacy `types` field when there is no `exports`", () => {
    const dir = packageWith(["dist/index.d.ts"]);

    expect(publishedEntries({ name: "@scope/pkg", types: "./dist/index.d.ts" }, dir)).toHaveLength(
      1,
    );
  });

  it("omits an entry whose file is not on disk, rather than reporting a path nobody can read", () => {
    // This is what `built: false` is derived from. A gate must be able to tell "declares none" from
    // "declared and missing", and it cannot if a phantom path is returned as an entry.
    const dir = packageWith(["dist/index.d.ts"]);
    const meta = {
      name: "@scope/pkg",
      exports: {
        ".": { import: { types: "./dist/index.d.ts" } },
        "./ghost": { import: { types: "./dist/ghost.d.ts" } },
      },
    };

    expect(publishedEntries(meta, dir).map((row) => row.specifier)).toEqual(["@scope/pkg"]);
  });

  it("skips a wildcard subpath, which names no single file to check", () => {
    // The literal file is created, so `existsSync` cannot be what rejects it. Without that fixture
    // this test passed with the wildcard guard DELETED — asserting an outcome another guard made.
    const dir = packageWith(["dist/index.d.ts", "dist/*.d.ts"]);
    const meta = {
      name: "@scope/pkg",
      exports: {
        ".": { import: { types: "./dist/index.d.ts" } },
        "./*": { import: { types: "./dist/*.d.ts" } },
      },
    };

    expect(publishedEntries(meta, dir)).toHaveLength(1);
  });

  it("does not mistake a bare path export for a declaration", () => {
    // `"./styles.css": "./dist/styles.css"` is a string, not a conditions object, and carries no
    // types. Treating it as one would put a stylesheet in front of the compiler.
    // The stylesheet is created, so `existsSync` cannot be what rejects it — only the check that a
    // bare string carries no types can. Without that fixture this test passed with the check gone.
    const dir = packageWith(["dist/index.d.ts", "dist/styles.css"]);
    const meta = {
      name: "@scope/pkg",
      exports: {
        ".": { import: { types: "./dist/index.d.ts" } },
        "./styles.css": "./dist/styles.css",
      },
    };

    expect(publishedEntries(meta, dir)).toHaveLength(1);
  });

  it("never returns the same declaration twice", () => {
    // Two subpaths pointing at one file would otherwise be compiled and counted twice, inflating
    // any coverage percentage derived from the entry list.
    const dir = packageWith(["dist/index.d.ts"]);
    const meta = {
      name: "@scope/pkg",
      exports: {
        ".": { import: { types: "./dist/index.d.ts" } },
        "./alias": { import: { types: "./dist/index.d.ts" } },
      },
    };

    expect(publishedEntries(meta, dir)).toHaveLength(1);
  });
});
