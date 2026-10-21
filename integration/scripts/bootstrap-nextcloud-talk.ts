/**
 * Boots a real Nextcloud server with Talk and provisions everything the live suite needs.
 *
 * Talk is self-hosted software, like Matrix and Mattermost, so a server booted for the run IS
 * the platform and no credential comes from anyone. This script:
 *
 * 1. starts `docker/nextcloud-talk/docker-compose.yml` and waits for `occ status` to say the
 *    server is installed;
 * 2. installs Talk (`spreed`) from the app store and lets the server call a bot on a private
 *    address (`allow_local_remote_servers`), which Nextcloud refuses by default;
 * 3. creates a conversation as `admin`, installs a bot whose webhook is the adapter's listener on
 *    the host (`host.docker.internal`), and attaches it to the conversation.
 *
 * The bot secret is generated here, per run, and written only to `integration/.env`; this script
 * never prints or logs it. It is visible in the process list (and `docker events`) while
 * `occ talk:bot:install` runs, since occ takes it only as an argument. NEXTCLOUD_TALK_* in the env
 * file are what the suite reads.
 *
 * Run:
 *   pnpm --filter @theokit/gateway-integration nextcloud-talk:up     # boot + provision
 *   pnpm --filter @theokit/gateway-integration exec vitest run tests/nextcloud-talk
 *   pnpm --filter @theokit/gateway-integration nextcloud-talk:down   # destroy
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { upsertEnvVar } from "../src/env-file.js";
import { reusedStateAdvice } from "../src/reused-state.js";

const COMPOSE = join(import.meta.dirname, "..", "docker", "nextcloud-talk", "docker-compose.yml");
const ENV_PATH = join(import.meta.dirname, "..", ".env");
const PORT = process.env.NEXTCLOUD_TALK_HOST_PORT ?? "28080";
const WEBHOOK_PORT = process.env.NEXTCLOUD_TALK_WEBHOOK_PORT ?? "28081";
const ADMIN_PASSWORD = process.env.NEXTCLOUD_TALK_ADMIN_PASSWORD ?? "theokit-integration-admin";
const BASE = `http://127.0.0.1:${PORT}`;
const BOT_NAME = "theokit-integration";
const AUTH = `Basic ${Buffer.from(`admin:${ADMIN_PASSWORD}`).toString("base64")}`;

interface Run {
  readonly status: number | null;
  /** stdout alone, for a command whose output is parsed. */
  readonly stdout: string;
  /** stdout and stderr joined, for a message: either may carry the reason. */
  readonly output: string;
}

/** Bounds each command, so a stalled app store fails the step instead of the CI job's cap. */
const COMMAND_TIMEOUT_MS = 300_000;

function run(cmd: string, args: readonly string[]): Run {
  const result = spawnSync(cmd, args, { encoding: "utf8", timeout: COMMAND_TIMEOUT_MS });
  if (result.error !== undefined) throw result.error;
  const stdout = result.stdout ?? "";
  return { status: result.status, stdout, output: `${stdout}\n${result.stderr ?? ""}`.trim() };
}

/** `occ` inside the container, as the web server's user. */
function occ(...args: string[]): Run {
  return run("docker", [
    "compose",
    "-f",
    COMPOSE,
    "exec",
    "-T",
    "-u",
    "www-data",
    "nextcloud",
    "php",
    "occ",
    ...args,
  ]);
}

/** Run `occ`, and stop the script with the reused-state remedy when it fails. */
function occOrExit(what: string, ...args: string[]): string {
  const result = occ(...args);
  if (result.status === 0) return result.stdout;
  process.stderr.write(`${what} failed (exit ${result.status}): ${result.output}\n`);
  const advice = reusedStateAdvice("nextcloud-talk", result.output);
  if (advice !== undefined) process.stderr.write(`${advice}\n`);
  process.exit(1);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

process.stdout.write("booting nextcloud…\n");
const up = run("docker", ["compose", "-f", COMPOSE, "up", "-d"]);
if (up.status !== 0) {
  process.stderr.write(`docker compose up failed: ${up.output}\n`);
  process.exit(1);
}

// The image installs Nextcloud on first start; `occ status` says when that finished.
let installed = false;
for (let i = 0; i < 90; i += 1) {
  if (occ("status").output.includes("installed: true")) {
    installed = true;
    break;
  }
  await sleep(2000);
}
if (!installed) {
  process.stderr.write("nextcloud did not finish installing within 180 s\n");
  process.exit(1);
}

occOrExit("installing Talk (spreed)", "app:install", "spreed");
occOrExit(
  "allowing a bot on a private address",
  "config:system:set",
  "allow_local_remote_servers",
  "--value",
  "true",
  "--type",
  "boolean",
);

// A public conversation needs no invitation to exist; admin owns it and writes in it.
const created = await fetch(`${BASE}/ocs/v2.php/apps/spreed/api/v4/room`, {
  method: "POST",
  headers: {
    authorization: AUTH,
    "ocs-apirequest": "true",
    accept: "application/json",
    "content-type": "application/json",
  },
  body: JSON.stringify({ roomType: 3, roomName: "theokit-integration" }),
  signal: AbortSignal.timeout(30_000),
});
const createdText = await created.text();
let room: string | undefined;
try {
  room = (JSON.parse(createdText) as { ocs?: { data?: { token?: string } } }).ocs?.data?.token;
} catch {
  // Not JSON: reported below with the body Nextcloud sent.
}
if (!created.ok || room === undefined) {
  process.stderr.write(
    `creating the conversation failed (HTTP ${created.status}): ${createdText.slice(0, 300)}\n`,
  );
  process.exit(1);
}

// 64 hex characters: inside Talk's 40 to 128, and never printed.
const secret = randomBytes(32).toString("hex");
const webhook = `http://host.docker.internal:${WEBHOOK_PORT}/nextcloud-talk`;
occOrExit(
  "installing the bot",
  "talk:bot:install",
  "--feature",
  "webhook",
  "--feature",
  "response",
  BOT_NAME,
  secret,
  webhook,
);
// `talk:bot:list` names each bot but not its URL (spreed 21.1.11), so match on the name.
const listed = occOrExit("listing bots", "talk:bot:list", "--output=json");
let bots: Array<{ id: number; name: string }>;
try {
  bots = JSON.parse(listed) as Array<{ id: number; name: string }>;
} catch (err) {
  process.stderr.write(`listing bots failed: talk:bot:list did not print JSON (${String(err)})\n`);
  process.exit(1);
}
const bot = bots.find((candidate) => candidate.name === BOT_NAME);
if (bot === undefined) {
  process.stderr.write(`the bot ${BOT_NAME} is not in talk:bot:list\n`);
  process.exit(1);
}
occOrExit("attaching the bot", "talk:bot:setup", String(bot.id), room);

upsertEnvVar(ENV_PATH, "NEXTCLOUD_TALK_URL", BASE);
upsertEnvVar(ENV_PATH, "NEXTCLOUD_TALK_BOT_SECRET", secret);
upsertEnvVar(ENV_PATH, "NEXTCLOUD_TALK_WEBHOOK_PORT", WEBHOOK_PORT);
upsertEnvVar(ENV_PATH, "NEXTCLOUD_TALK_ROOM", room);
upsertEnvVar(ENV_PATH, "NEXTCLOUD_TALK_USER_PASSWORD", ADMIN_PASSWORD);

process.stdout.write(
  [
    "",
    `nextcloud:    ${BASE}`,
    `conversation: ${room}`,
    `bot:          ${bot.id}, webhook ${webhook}`,
    "",
    "NEXTCLOUD_TALK_* written to integration/.env (the bot secret is not shown).",
    "Tear down with: pnpm --filter @theokit/gateway-integration nextcloud-talk:down",
    "",
  ].join("\n"),
);
