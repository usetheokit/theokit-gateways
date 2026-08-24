#!/usr/bin/env node
// Integration-story gate — raised by B-011.
//
// Three repositories share one seam and no document connected them. TheoKit owns the channel route
// and the signature check; these packages translate the payload it hands over; the SDK's role is
// one redaction helper, which B-012 is open about. Measured against `theokit@0.48.14`: the seam is
// documented ONLY in `dist/server/agent/index.d.ts` — which is where someone already inside the
// type looks, and B-010 measured that to be exactly where developers do not go first.
//
// WHAT THIS ASSERTS, AND WHAT IT DELIBERATELY DOES NOT.
//
// A vocabulary gate over prose makes the prose unchangeable. If this checked phrases, rewriting
// "TheoKit's channel webhook" more clearly would fail it, and the next author would learn to paste
// the magic words back and ignore the meaning — which is the hollow section this gate exists to
// prevent, arrived at from the other direction.
//
// So it asserts only facts that cannot be paraphrased without ceasing to be the fact: an exported
// symbol name, and two repository names. Everything around them is free prose, and rewriting the
// section while keeping those is a PASS by design, verified by mutation.
//
// It asserts presence, never accuracy. A section naming both repositories and assigning the halves
// backwards passes. Checking that would mean testing a claim about another repository's behaviour,
// which this gate cannot do — recorded rather than implied.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LABEL = "integration-story";
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * The documents a developer meets first, and the facts each must carry.
 *
 * The root README is the repository's front page; the core package's README is its **npm** page,
 * which is what someone installing a package actually reads.
 */
const REQUIRED = [
  {
    file: "README.md",
    facts: ["handleChannelWebhook", "theokit-sdk", "theokit-gateways"],
  },
  {
    file: join("packages", "gateway", "README.md"),
    facts: ["handleChannelWebhook", "theokit-sdk"],
  },
];

/** The facts a document is missing, as the reasons it fails. */
function missingFacts(file, facts) {
  let text;
  try {
    text = readFileSync(join(ROOT, file), "utf8");
  } catch {
    return [`${file}: not found`];
  }
  return facts.filter((fact) => !text.includes(fact)).map((fact) => `${file}: never names ${fact}`);
}

function main() {
  const missing = REQUIRED.flatMap(({ file, facts }) => missingFacts(file, facts));

  if (missing.length > 0) {
    console.error(`[${LABEL}] x ${missing.length} fact(s) missing from the integration story:`);
    for (const line of missing) console.error(`    ${line}`);
    console.error(
      `\n[${LABEL}] FAIL — a developer wiring a gateway has to read a .d.ts to learn which` +
        " repository owns which half of the seam. See docs/adr/0002-platform-event-registry.md.",
    );
    process.exit(1);
  }

  console.log(
    `[${LABEL}] PASS — ${REQUIRED.length} document(s) name the seam and the sibling repositories.`,
  );
}

main();
