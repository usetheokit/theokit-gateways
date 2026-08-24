#!/usr/bin/env node
// Integration-story gate — raised by B-011, rewritten after the review of `cc5005f`.
//
// Three repositories share one seam and no document connected them. TheoKit owns the channel route
// and the signature check; these packages translate the payload it hands over; the SDK's role is
// one redaction helper, which B-012 is open about. Measured against `theokit@0.48.14`: the seam is
// documented ONLY in `dist/server/agent/index.d.ts` — which is where someone already inside the
// type looks, and B-010 measured that to be exactly where developers do not go first.
//
// The rules it applies, and the ones it refuses to apply, live in `lib/integration-story.mjs`. The
// short version: a fact counts inside the section meant to carry it, in visible prose — the first
// version looked file-wide, and both sections could be deleted without failing it.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { missingFacts } from "./lib/integration-story.mjs";

const LABEL = "integration-story";
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * The documents a developer meets first, the section that must tell the story in each, and the
 * facts that section must name.
 *
 * The root README is the repository's front page; the core package's README is its **npm** page,
 * which is what someone installing a package actually reads.
 */
const REQUIRED = [
  {
    file: "README.md",
    heading: "How this fits with TheoKit",
    facts: ["handleChannelWebhook", "theokit-sdk", "theokit-gateways"],
  },
  {
    file: join("packages", "gateway", "README.md"),
    heading: "Receiving from a TheoKit app",
    facts: ["handleChannelWebhook", "theokit-sdk"],
  },
];

/** The document's text, or undefined when it is not there. */
function read(file) {
  try {
    return readFileSync(join(ROOT, file), "utf8");
  } catch {
    return undefined;
  }
}

function main() {
  const faults = REQUIRED.flatMap((required) => missingFacts(read(required.file), required));

  if (faults.length > 0) {
    console.error(`[${LABEL}] x ${faults.length} fault(s) in the integration story:`);
    for (const line of faults) console.error(`    ${line}`);
    console.error(
      `\n[${LABEL}] FAIL — a developer wiring a gateway has to read a .d.ts to learn which` +
        " repository owns which half of the seam. See B-011 in BACKLOG.md.",
    );
    process.exit(1);
  }

  console.log(
    `[${LABEL}] PASS — ${REQUIRED.length} section(s) name the seam and the sibling repositories.` +
      " Presence only: this gate does not check that what they say is true.",
  );
}

main();
