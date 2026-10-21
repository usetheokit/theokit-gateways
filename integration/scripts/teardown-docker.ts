/**
 * Destroys a provisioned server AND forgets the credentials it issued.
 *
 * The second half is the point. Tearing the container down while leaving
 * MATRIX_* or MATTERMOST_* in `.env` leaves the suite pointing at a server that
 * no longer exists — so it FAILS where it should SKIP, and the report reads as a
 * broken adapter rather than an absent fixture. That happened on the first full
 * run after adding Mattermost, and it is the kind of noise that teaches people
 * to ignore a red suite.
 *
 * Teardown removing exactly what bootstrap wrote keeps the two symmetrical:
 * either the server and its credentials both exist, or neither does.
 *
 * Run: pnpm --filter @theokit/gateway-integration matrix:down
 *      pnpm --filter @theokit/gateway-integration mattermost:down
 *      pnpm --filter @theokit/gateway-integration nextcloud-talk:down
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Each server this package boots, and the prefix of every env line its bootstrap writes. */
const PREFIXES: Readonly<Record<string, string>> = {
  matrix: "MATRIX_",
  mattermost: "MATTERMOST_",
  "nextcloud-talk": "NEXTCLOUD_TALK_",
};

// A platform with no prefix exits here, before the env file is read: an empty prefix matches
// every line, and clearing the operator's whole file is not a fallback anyone wants.
const PLATFORM = process.argv[2] ?? "";
const prefix = PREFIXES[PLATFORM];
if (prefix === undefined) {
  process.stderr.write(`usage: teardown-docker.ts <${Object.keys(PREFIXES).join("|")}>\n`);
  process.exit(1);
}

const COMPOSE = join(import.meta.dirname, "..", "docker", PLATFORM, "docker-compose.yml");
const ENV_PATH = join(import.meta.dirname, "..", ".env");

const down = spawnSync("docker", ["compose", "-f", COMPOSE, "down", "-v"], { encoding: "utf8" });
if (down.status !== 0) {
  // Not fatal: the container may already be gone, and the env still needs clearing.
  process.stderr.write(`docker compose down exited ${down.status}\n`);
}

let text: string | undefined;
try {
  text = readFileSync(ENV_PATH, "utf8");
} catch (err) {
  // No env file is fine — nothing to forget. Any other failure to read it is not.
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}

let removed = 0;
if (text !== undefined) {
  // Only this platform's lines go; blank lines and comments stay where the operator put them.
  const kept = text.split("\n").filter((line) => {
    const isOurs = line.trimStart().startsWith(prefix);
    if (isOurs) removed += 1;
    return !isOurs;
  });
  writeFileSync(ENV_PATH, kept.join("\n"));
}

process.stdout.write(`${PLATFORM}: container removed, ${removed} ${prefix}* entries cleared\n`);
