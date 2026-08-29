// Optional shim — restores the `util` type that `@types/node@26` renamed (#81).
//
// NOT loaded by this package. Nothing here references it, and a consumer who does not need it is
// unaffected. That is deliberate: a library that augments Node's own types for everyone changes the
// type environment of people who never asked, and a conflict from it would surface far from here.
//
// WHEN YOU NEED IT
//
// You installed `@types/node@26` (the current `latest`) and typechecking fails inside a package you
// never installed:
//
//   @sapphire/shapeshift/dist/esm/index.d.mts(1,10): error TS2305:
//     Module '"util"' has no exported member 'InspectOptionsStylized'.
//
// `@types/node@26` renamed `util.InspectOptionsStylized` to `InspectContext`. `@sapphire/shapeshift@4`
// — which `discord.js` pulls through `@discordjs/builders` — still imports the old name, and
// `@sapphire/shapeshift@5` imports the new one and so breaks on `@types/node@22`. No release
// satisfies both lines, and `@discordjs/builders@1.14.1` still declares `^4.0.0`, so nothing in the
// discord.js chain reaches v5 yet.
//
// HOW TO USE IT
//
//   // tsconfig.json
//   { "include": ["src", "node_modules/@theokit/gateway-discord/shims/types-node-26.d.ts"] }
//
// Measured 2026-08-29 in a scratch consumer: with `@types/node@26` the project fails to compile and
// passes with this file included; with `@types/node@22` it passes either way — the declaration below
// merges with the interface that already exists there and adds nothing.
//
// WHEN TO DELETE IT
//
// When `@discordjs/builders` moves to `@sapphire/shapeshift@5`. You will not have to remember: on
// that day `pnpm quality:dts-typechecks` starts failing for the opposite reason — v5 imports
// `InspectContext`, which the `@types/node@22` this repository pins does not have — so the gate
// raises its hand rather than leaving a stale shim shipping forever.
import type { InspectOptions } from "util";

declare module "util" {
  interface InspectOptionsStylized extends InspectOptions {
    stylize(text: string, styleType: string): string;
  }
}
