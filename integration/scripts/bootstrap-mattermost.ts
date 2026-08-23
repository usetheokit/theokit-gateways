/**
 * Boots a real Mattermost server and provisions everything the live suite needs.
 *
 * Like Matrix, this platform is self-hosted software, so a real server IS the
 * platform rather than a stand-in — and no credential leaves the machine. The
 * first account created through the API on an empty instance becomes the system
 * admin, which is what lets the whole fixture be built with no console.
 *
 * Run:
 *   pnpm --filter @theokit/gateway-integration mattermost:up
 *   pnpm --filter @theokit/gateway-integration integration
 *   pnpm --filter @theokit/gateway-integration mattermost:down
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { reusedStateAdvice } from "../src/reused-state.js";

const COMPOSE = join(import.meta.dirname, "..", "docker", "mattermost", "docker-compose.yml");
const ENV_PATH = join(import.meta.dirname, "..", ".env");
const PORT = process.env.MATTERMOST_HOST_PORT ?? "28065";
const ROOT = `http://127.0.0.1:${PORT}`;
const API = `${ROOT}/api/v4`;
const PASSWORD = "E2e-local-pass1";

function sh(cmd: string, args: string[]): string {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function upsertEnv(entries: Record<string, string>): void {
  let text = "";
  try {
    text = readFileSync(ENV_PATH, "utf8");
  } catch {
    // First write.
  }
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  for (const [key, value] of Object.entries(entries)) {
    const idx = lines.findIndex((l) => l.trimStart().startsWith(`${key}=`));
    if (idx >= 0) lines[idx] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  writeFileSync(ENV_PATH, `${lines.join("\n")}\n`);
}

interface ApiResult {
  status: number;
  body: Record<string, string>;
  token?: string;
}

async function api(
  path: string,
  opts: { body?: unknown; token?: string; method?: string } = {},
): Promise<ApiResult> {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(opts.token === undefined ? {} : { authorization: `Bearer ${opts.token}` }),
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, string>;
  // Login answers with the session token in a header, not the body.
  return { status: res.status, body, token: res.headers.get("Token") ?? undefined };
}

/**
 * Reads a field the API is contracted to return.
 *
 * `noUncheckedIndexedAccess` types every field as possibly undefined, which is
 * right: the server could change its response and this script would otherwise
 * write the string "undefined" into .env and fail much later, inside a test.
 */
function field(result: ApiResult, name: string, step: string): string {
  const value = result.body[name];
  if (value === undefined) {
    process.stderr.write(`${step}: response had no "${name}" (${result.status})\n`);
    process.exit(1);
  }
  return value;
}

function fail(step: string, result: ApiResult): never {
  const detail = result.body.message ?? JSON.stringify(result.body).slice(0, 160);
  process.stderr.write(`${step} failed (${result.status}): ${detail}\n`);
  // "An account with that username already exists" describes what the server refused, not why a
  // fresh bootstrap hit it. Without this line the reader goes looking for a name collision; the
  // cause is a container that outlived the last run, and the remedy is one command.
  const advice = reusedStateAdvice("mattermost", detail);
  if (advice !== undefined) process.stderr.write(`${advice}\n`);
  process.exit(1);
}

process.stdout.write("booting Mattermost (this one takes tens of seconds)…\n");
sh("docker", ["compose", "-f", COMPOSE, "up", "-d"]);

let ready = false;
for (let i = 0; i < 120; i += 1) {
  try {
    const res = await fetch(`${API}/system/ping`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      ready = true;
      break;
    }
  } catch {
    // Not up yet.
  }
  await new Promise((r) => setTimeout(r, 1000));
}
if (!ready) {
  process.stderr.write(`Mattermost did not answer at ${ROOT}\n`);
  process.exit(1);
}

// The FIRST user on an empty instance is made system admin — which is what makes
// the rest of this possible without touching the console.
const created = await api("/users", {
  body: { email: "admin@theokit.test", username: "theokit-bot", password: PASSWORD },
});
if (created.status !== 201) fail("create first user", created);

const login = await api("/users/login", {
  body: { login_id: "theokit-bot", password: PASSWORD },
});
if (login.token === undefined) fail("login", login);
const session = login.token;
const botId = field(login, "id", "login");

const team = await api("/teams", {
  body: { name: "theokit-integration", display_name: "theokit integration", type: "O" },
  token: session,
});
if (team.status !== 201) fail("create team", team);
const teamId = field(team, "id", "create team");

const probe = await api("/users", {
  body: { email: "probe@theokit.test", username: "theokit-probe", password: PASSWORD },
  token: session,
});
if (probe.status !== 201) fail("create probe user", probe);
const probeId = field(probe, "id", "create probe user");

for (const userId of [botId, probeId]) {
  const member = await api(`/teams/${teamId}/members`, {
    body: { team_id: teamId, user_id: userId },
    token: session,
  });
  if (member.status !== 201) fail("add team member", member);
}

const channel = await api("/channels", {
  body: {
    team_id: teamId,
    name: "theokit-integration",
    display_name: "theokit integration",
    type: "O",
  },
  token: session,
});
if (channel.status !== 201) fail("create channel", channel);
const channelId = field(channel, "id", "create channel");

for (const userId of [botId, probeId]) {
  const member = await api(`/channels/${channelId}/members`, {
    body: { user_id: userId },
    token: session,
  });
  if (member.status !== 201) fail("add channel member", member);
}

/**
 * A PERSONAL ACCESS TOKEN, not the session token.
 *
 * The adapter authenticates with a PAT, and the two behave differently: a
 * session expires and is invalidated by logout, so a suite built on one would
 * start failing for reasons that have nothing to do with the code. The server is
 * started with EnableUserAccessTokens because they are off by default.
 */
const pat = await api(`/users/${botId}/tokens`, {
  body: { description: "theokit-integration" },
  token: session,
});
const botToken = pat.body.token;
if (botToken === undefined) fail("issue personal access token", pat);

// The probe needs its own PAT to post as an identity that is not the bot.
const probeLogin = await api("/users/login", {
  body: { login_id: "theokit-probe", password: PASSWORD },
});
if (probeLogin.token === undefined) fail("probe login", probeLogin);
const probePat = await api(`/users/${probeId}/tokens`, {
  body: { description: "theokit-integration-probe" },
  token: session,
});
const probeToken = probePat.body.token;
if (probeToken === undefined) fail("issue probe token", probePat);

upsertEnv({
  MATTERMOST_BASE_URL: ROOT,
  MATTERMOST_ACCESS_TOKEN: botToken,
  MATTERMOST_TEST_CHANNEL_ID: channelId,
  MATTERMOST_TEST_SENDER_TOKEN: probeToken,
});

process.stdout.write(
  [
    "",
    `server:   ${ROOT}`,
    `bot:      theokit-bot (${botId})`,
    `probe:    theokit-probe (${probeId})`,
    `channel:  ${channelId}`,
    "",
    "MATTERMOST_* written to integration/.env. Run: pnpm integration",
    "Tear down with: pnpm --filter @theokit/gateway-integration mattermost:down",
    "",
  ].join("\n"),
);
