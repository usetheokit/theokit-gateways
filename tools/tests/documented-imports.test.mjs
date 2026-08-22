// Every case here is a defect this extraction actually had, or one a sibling repository hit with
// the same code. They are regression tests before they are unit tests: the gate's whole failure
// mode is the FALSE POSITIVE — accusing an innocent document — and a false positive costs the
// reading plus everyone's trust in the next report.

import { describe, expect, it } from "vitest";

import { importsIn, isDocumentation, stripDiffRemovals } from "../lib/documented-imports.mjs";

describe("stripDiffRemovals", () => {
  it("drops the line a migration guide is moving the reader away from", () => {
    // Found on `theokit-plugins`: 3 of 22 initial findings were removed lines in a ```diff block,
    // naming the old API on purpose. Reading them as instructions accuses the guide of describing
    // the rename it exists to describe.
    const markdown = [
      "```diff",
      '-import { payments } from "@theokit/plugin-payments";',
      "```",
    ].join("\n");

    expect(importsIn("guide.md", markdown)).toEqual([]);
  });

  it("keeps the line the reader should end up with", () => {
    const markdown = [
      "```diff",
      '-import { payments } from "@theokit/plugin-payments";',
      '+import { payments } from "@theokit/plugin-payments/stripe";',
      "```",
    ].join("\n");

    const claims = importsIn("guide.md", markdown);

    expect(claims).toHaveLength(1);
    expect(claims[0].specifier).toBe("@theokit/plugin-payments/stripe");
  });

  it("keeps a list bullet that is not inside a diff fence", () => {
    // A `-` outside a ```diff block is markdown, and stripping it would silently blind the gate to
    // every import documented in a bulleted list.
    const markdown = ['- see: `import { A } from "@theokit/gateway";`'].join("\n");

    expect(importsIn("readme.md", markdown)).toHaveLength(1);
  });

  it("stops treating `-` as a removal once the diff fence closes", () => {
    const markdown = [
      "```diff",
      '-import { Gone } from "@theokit/gateway";',
      "```",
      "",
      '- `import { Kept } from "@theokit/gateway";`',
    ].join("\n");

    const claims = importsIn("readme.md", markdown);

    expect(claims.map((claim) => claim.names[0])).toEqual(["Kept"]);
  });

  it("does not treat a non-diff fence as a diff", () => {
    const markdown = ["```ts", '// -import { A } from "@theokit/gateway";', "```"].join("\n");

    expect(stripDiffRemovals(markdown)).toBe(markdown);
  });

  it("preserves line numbers, so a finding points at the right line", () => {
    // Blanking rather than deleting is the whole reason this returns a same-length document: a
    // report that names the wrong line sends the reader hunting.
    const markdown = [
      "# Title",
      "```diff",
      '-import { Gone } from "@theokit/gateway";',
      '+import { Kept } from "@theokit/gateway";',
      "```",
    ].join("\n");

    expect(importsIn("readme.md", markdown)[0].line).toBe(4);
  });
});

describe("importsIn", () => {
  it("reads every specifier, not only our own scope", () => {
    // The first version matched `@theokit/*` alone. `theokit-plugins` found ten documented names
    // missing from the framework itself while a gate scoped that way reported all-clear.
    const markdown = [
      'import { route } from "theokit/server";',
      'import { z } from "zod";',
      'import { Adapter } from "@theokit/gateway";',
    ].join("\n");

    expect(importsIn("readme.md", markdown).map((claim) => claim.specifier)).toEqual([
      "theokit/server",
      "zod",
      "@theokit/gateway",
    ]);
  });

  it("ignores a relative specifier, which names no package to resolve", () => {
    expect(importsIn("readme.md", 'import { local } from "./helpers.js";')).toEqual([]);
  });

  it("strips the `type` modifier from names", () => {
    const claims = importsIn(
      "readme.md",
      'import { type MessageEvent, Adapter } from "@theokit/gateway";',
    );

    expect(claims[0].names).toEqual(["MessageEvent", "Adapter"]);
  });

  it("drops ellipsis and other prose stand-ins that are not identifiers", () => {
    // `import { Adapter, … } from` appears in abbreviated examples. Handing `…` to the compiler
    // produces a syntax error in the probe, which reports as drift against an innocent document.
    const claims = importsIn("readme.md", 'import { Adapter, … } from "@theokit/gateway";');

    expect(claims[0].names).toEqual(["Adapter"]);
  });

  it("yields nothing when an import names no identifier at all", () => {
    expect(importsIn("readme.md", 'import { … } from "@theokit/gateway";')).toEqual([]);
  });
});

describe("isDocumentation", () => {
  it("excludes CHANGELOG, which names removed symbols on purpose", () => {
    // An entry reading "removed `defineStripeWebhook`" is a historical record, and a released entry
    // is immutable (Unbreakable Rule 6). Checking it would demand rewriting history to satisfy an
    // instrument.
    expect(isDocumentation("CHANGELOG.md")).toBe(false);
    expect(isDocumentation("packages/gateway/CHANGELOG.md")).toBe(false);
  });

  it("excludes changesets, which describe a release rather than an API", () => {
    expect(isDocumentation(".changeset/some-change.md")).toBe(false);
  });

  it("includes READMEs, which are instructions to a reader", () => {
    expect(isDocumentation("README.md")).toBe(true);
    expect(isDocumentation("packages/gateway-slack/README.md")).toBe(true);
  });

  it("does not mistake a file merely containing the word changelog", () => {
    expect(isDocumentation("docs/changelog-policy.md")).toBe(true);
  });
});
