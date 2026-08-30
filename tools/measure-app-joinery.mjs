#!/usr/bin/env node
/**
 * Count the channel joinery a consuming app carries, under ONE stated metric.
 *
 * Exists as a committed script rather than an ad-hoc command because the number it produces
 * is a BASELINE: a later run subtracts from it to say whether a change absorbed the
 * joinery. An ad-hoc recount is a new measurement wearing the old one's name, and mixing
 * two metrics is an error this repository has already paid for once — a review reported 973
 * lines by counting raw lines against a table built from a looser filter, and the error ran
 * in the direction that flattered the argument.
 *
 * The metric: a line that is neither blank nor comment-only. Block comments are tracked, so
 * prose inside one never counts as code.
 *
 * Usage: node tools/measure-app-joinery.mjs <app-root>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Files that exist in the consuming app only because the framework does not own the seam. */
const FILES = [
  ["server/gateways.ts", "gap", "catalog: which platforms, how to build, what config"],
  ["server/gateway-agents.ts", "gap", "lifecycle: connect, status, failure isolation"],
  [
    "server/routes/agents/[agent]/channels/[platform]/webhook.ts",
    "gap",
    "per-platform parse + send dispatch",
  ],
  ["server/line.ts", "gap", "validator bridge"],
  ["server/gateway.ts", "gap", "per-platform leftovers"],
  ["server/agent-loop.ts", "presenter", "agent stream -> one chat message"],
  ["server/whatsapp-pairing.ts", "mixed", "pairing lifecycle + reply addressing"],
  ["server/whatsapp-inbound.ts", "mixed", "cloud webhook: statuses + answer"],
  ["server/routes/gateways/agents.ts", "app", "control surface"],
  ["server/routes/gateways/probe.ts", "app", "control surface"],
  ["server/routes/gateways/whatsapp/pairing.ts", "app", "control surface"],
  ["server/routes/gateways/whatsapp/send.ts", "app", "control surface"],
];

/** Is this trimmed line blank, a line comment, or a block-comment continuation? */
function isNotCode(line) {
  return line === "" || line.startsWith("//") || line.startsWith("*");
}

/** Lines that are neither blank nor comment-only. The one metric this script reports. */
function codeLines(text) {
  let n = 0;
  let inBlock = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (inBlock) {
      inBlock = !line.includes("*/");
      continue;
    }
    if (line.startsWith("/*")) {
      inBlock = !line.includes("*/");
      continue;
    }
    if (!isNotCode(line)) n += 1;
  }
  return n;
}

const root = process.argv[2];
if (root === undefined) {
  process.stderr.write("usage: node tools/measure-app-joinery.mjs <app-root>\n");
  process.exit(2);
}

const rows = [];
for (const [rel, owner, why] of FILES) {
  let count = 0;
  let present = true;
  try {
    count = codeLines(readFileSync(join(root, rel), "utf8"));
  } catch {
    // An absent file counts as zero and says so: after the change, files are EXPECTED to
    // disappear, and a crash here would make the success case look like a broken script.
    present = false;
  }
  rows.push({ file: rel, owner, why, loc: count, present });
}

const byOwner = {};
for (const r of rows) byOwner[r.owner] = (byOwner[r.owner] ?? 0) + r.loc;
const total = rows.reduce((a, r) => a + r.loc, 0);

const report = JSON.stringify(
  { metric: "lines neither blank nor comment-only", root, rows, byOwner, total },
  null,
  2,
);
process.stdout.write(`${report}\n`);
