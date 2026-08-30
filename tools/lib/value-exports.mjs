// The VALUES a published entry exports, read by the compiler from the emitted files.
//
// Separated from the gate so it can be unit-tested, because the whole check turns on one
// distinction that is easy to get wrong: a type is not a value. Comparing raw export lists between
// a `.d.ts` and its `.js` reports every interface and type alias as missing at runtime — measured
// here on 2026-08-20, 78 "divergences", all of them the instrument. Only symbols that carry a VALUE
// meaning exist in both files and can honestly be compared.

import { createRequire } from "node:module";

// Resolved BY NAME, never by path. Requiring a directory bypasses the package's `exports` map —
// Node only consults `exports` when resolving a bare specifier — so a path-require depends on the
// package still declaring `main`, and on the package manager having hoisted it to the root. Both
// assumptions broke at once on 2026-08-28: pnpm is free to place the package anywhere, and
// TypeScript 7 ships `exports` with no `main`, so the path form fails outright. The name form asks
// Node to do what Node does, and works under either layout.
const ts = createRequire(import.meta.url)("typescript");

/**
 * @param {string} file a `.d.ts` or the `.js` beside it
 * @param {boolean} allowJs true when reading the runtime file
 * @returns {Set<string> | undefined} exported names that denote a value, or undefined when the
 * compiler could not read the file — which the caller must treat as a broken gate, never as an
 * empty result.
 */
export function valueExportsOf(file, allowJs) {
  const program = ts.createProgram([file], {
    noEmit: true,
    skipLibCheck: true,
    allowJs,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const source = program.getSourceFile(file);
  if (source === undefined) return undefined;
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined) return undefined;

  const values = new Set();
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    // Follow the alias: a re-export's own flags say nothing about what it points at.
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    if (target.flags & ts.SymbolFlags.Value) values.add(symbol.getName());
  }
  return values;
}

/**
 * Compares one package's declaration against its runtime.
 *
 * @returns {{missingTypes: string[], missingRuntime: string[]}} `missingTypes` is a value the
 * runtime exports and the declaration does not — a consumer cannot import it in TypeScript at all.
 * `missingRuntime` is the reverse and is worse: it compiles, then the import is `undefined` when
 * the program runs.
 */
export function compareExports(types, runtime) {
  return {
    missingTypes: [...runtime].filter((name) => !types.has(name)).sort(),
    missingRuntime: [...types].filter((name) => !runtime.has(name)).sort(),
  };
}
