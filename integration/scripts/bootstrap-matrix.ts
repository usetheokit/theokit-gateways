/**
 * Boots a real Matrix homeserver and provisions everything the live suite needs.
 *
 * Unlike every other platform here, Matrix asks nothing of a human — there is no
 * account to create and no credential to store, because the server is created
 * per run and destroyed with it. There is also no alternative: matrix.org
 * answers registration with "Only m.login.application_service registrations are
 * allowed", and every other public homeserver tried has closed registration too.
 *
 * That is the better path anyway. Matrix is federated by design and most
 * deployments are self-hosted, so a real homeserver IS the platform — unlike
 * Slack or Discord, which exist only as SaaS.
 *
 * It writes MATRIX_* into `integration/.env`, so the suite reads them exactly the way it
 * reads a hosted platform's credentials and cannot tell the difference.
 *
 * Run:
 *   pnpm --filter @theokit/gateway-integration matrix:up      # boot + provision
 *   pnpm --filter @theokit/gateway-integration integration            # run
 *   pnpm --filter @theokit/gateway-integration matrix:down    # destroy
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { reusedStateAdvice } from "../src/reused-state.js";

const COMPOSE = join(import.meta.dirname, "..", "docker", "matrix", "docker-compose.yml");
const ENV_PATH = join(import.meta.dirname, "..", ".env");
const PORT = process.env.MATRIX_HOST_PORT ?? "26167";
const BASE = `http://127.0.0.1:${PORT}`;

/** Runs a command and returns stdout and stderr joined — either may carry the output. */
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

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body: parsed };
}

async function put(path: string, body: unknown, token: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body: parsed };
}

process.stdout.write("booting homeserver…\n");
sh("docker", ["compose", "-f", COMPOSE, "up", "-d"]);

let ready = false;
for (let i = 0; i < 60; i += 1) {
  try {
    const res = await fetch(`${BASE}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      ready = true;
      break;
    }
  } catch {
    // Not up yet.
  }
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) {
  process.stderr.write(`homeserver did not answer at ${BASE}\n`);
  process.exit(1);
}

/**
 * Continuwuity refuses the CONFIGURED registration token until one account has
 * been created with a bootstrap token it prints to the log — a guard against an
 * open server being registered on before its owner has touched it. Only the real
 * server tells you this; a mock has no such opinion.
 *
 * The banner is printed AFTER the client API starts answering, so reading the
 * log the moment `/_matrix/client/versions` returns 200 finds nothing, and the
 * failure surfaces as "Invalid registration token" for a token never sent. Hence
 * the poll.
 *
 * The pattern demands something token-shaped because the log also says "The
 * registration token you set in your configuration will not function...", which
 * a `\S+` would happily capture as "you". The ANSI strip stays even though
 * `docker compose` drops colour when its output is not a terminal: one cheap
 * regex against the day someone runs this with a TTY attached.
 */
async function readBootstrapToken(): Promise<string | undefined> {
  for (let i = 0; i < 40; i += 1) {
    const logs = sh("docker", ["compose", "-f", COMPOSE, "logs", "homeserver"]);
    // Stripping ANSI means matching a control character; that is the point, not an oversight.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is what an ANSI escape starts with
    const plain = logs.replace(/\u001b\[[0-9;]*m/g, "");
    const found = plain.match(/registration token ([A-Za-z0-9]{8,})/)?.[1];
    if (found !== undefined) return found;
    await new Promise((r) => setTimeout(r, 500));
  }
  return undefined;
}

const bootstrapToken = await readBootstrapToken();
if (bootstrapToken === undefined) {
  process.stderr.write(
    "could not read the bootstrap registration token from the homeserver log.\n" +
      "Continuwuity prints it once at first start, so a reused volume will not have it:\n" +
      "run `pnpm --filter @theokit/gateway-integration matrix:down` and try again.\n",
  );
  process.exit(1);
}

async function register(username: string, token: string) {
  const first = await post("/_matrix/client/v3/register", {
    username,
    password: "integration-local",
  });
  const session = first.body.session as string | undefined;
  const done = await post("/_matrix/client/v3/register", {
    username,
    password: "integration-local",
    auth: { type: "m.login.registration_token", token, session },
  });
  const accessToken = done.body.access_token as string | undefined;
  const userId = done.body.user_id as string | undefined;
  if (accessToken === undefined || userId === undefined) {
    const detail = JSON.stringify(done.body).slice(0, 200);
    // The token WAS found in the log and WAS sent — it is refused because the server already
    // consumed it at first boot. Left alone, this message sends the reader hunting a wrong token,
    // which is the one thing that is not wrong. The docblock above covers the neighbouring case
    // (a log that no longer holds the token) and prints the same remedy; this is the case it did
    // not cover.
    const advice = reusedStateAdvice("matrix", detail);
    if (advice !== undefined) process.stderr.write(`${advice}\n`);
    throw new Error(`register ${username} failed: ${detail}`);
  }
  return { userId, accessToken };
}

// The bot under test, and a SECOND account to send from. Every platform in this
// suite has a loop guard that hides messages the bot sent itself; a round trip
// needs an independent sender, and Matrix is no exception.
const bot = await register("theokit-bot", bootstrapToken);
const probe = await register("theokit-probe", "theokit-integration");
process.stdout.write(`registered ${bot.userId} and ${probe.userId}\n`);

const room = await post(
  "/_matrix/client/v3/createRoom",
  { name: "theokit-integration", preset: "private_chat", invite: [bot.userId] },
  probe.accessToken,
);
const roomId = room.body.room_id as string | undefined;
if (roomId === undefined) {
  process.stderr.write(`createRoom failed: ${JSON.stringify(room.body).slice(0, 200)}\n`);
  process.exit(1);
}
await post(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`, {}, bot.accessToken);

// One message so the room has history before the suite attaches to it.
await put(
  `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/bootstrap-${process.pid}`,
  { msgtype: "m.text", body: "theokit-integration fixture room" },
  probe.accessToken,
);

upsertEnv({
  MATRIX_HOMESERVER_URL: BASE,
  MATRIX_ACCESS_TOKEN: bot.accessToken,
  MATRIX_USER_ID: bot.userId,
  MATRIX_TEST_ROOM_ID: roomId,
  MATRIX_TEST_SENDER_TOKEN: probe.accessToken,
  MATRIX_TEST_SENDER_USER_ID: probe.userId,
});

process.stdout.write(
  [
    "",
    `homeserver:  ${BASE}`,
    `bot:         ${bot.userId}`,
    `probe:       ${probe.userId}`,
    `room:        ${roomId}`,
    "",
    "MATRIX_* written to integration/.env. Run: pnpm integration",
    "Tear down with: pnpm --filter @theokit/gateway-integration matrix:down",
    "",
  ].join("\n"),
);
