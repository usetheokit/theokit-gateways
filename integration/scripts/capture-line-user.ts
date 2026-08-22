/**
 * Captures `LINE_TEST_USER_ID` from one real webhook delivery.
 *
 * LINE is the only platform here whose target id cannot be read from any
 * console or API: `/v2/bot/followers/ids` answers 403 "Access to this API is
 * not available for your account" on an unverified Official Account, and
 * neither the Developers Console nor the Official Account Manager shows the raw
 * `U…` anywhere. Adding the bot as a friend is not enough.
 *
 * What IS available is a webhook delivery, which carries `source.userId`. So
 * this opens a throwaway HTTPS tunnel, serves one request, takes the id, and
 * shuts everything down. The id never changes, so this runs once — the outbound
 * suite then works forever with no tunnel.
 *
 * Deliberately small: no persistent tunnel, no named DNS, no daemon. Those
 * would be infrastructure for a need that does not exist yet.
 *
 * This file is a composition root and nothing else. Every decision it makes —
 * which binary to drive, which port to bind, whether a request may set the
 * variable, how the value reaches `.env` — lives in a tested module under
 * `src/`, because none of them could be tested through a public tunnel and a
 * real delivery from LINE.
 *
 * Two defects fixed here (#35):
 *
 *   - It used to DOWNLOAD cloudflared from `releases/latest`, `chmod 755` it
 *     and execute it, with the exit code of `curl` as the only control. It now
 *     requires one already installed, whose package manager verified its
 *     signature. See `src/tunnel-binary.ts`.
 *   - It used to answer 200 to anything and take `source.userId` from whatever
 *     arrived, on a PUBLIC URL, while `LINE_CHANNEL_SECRET` sat unused in the
 *     same `.env`. It now verifies LINE's HMAC before parsing. See
 *     `src/line-capture.ts`.
 *
 * Run: pnpm --filter @theokit/gateway-integration capture:line
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";

import { required } from "../src/credentials.js";
import { upsertEnvVar } from "../src/env-file.js";
import { decideCapture, parseCapturePort } from "../src/line-capture.js";
import {
  canExecute,
  resolveTunnelBinary,
  TunnelBinaryUnavailableError,
} from "../src/tunnel-binary.js";

const ENV_PATH = join(import.meta.dirname, "..", ".env");

/** A webhook delivery is a few KB. Anything past this is not one, so stop reading. */
const MAX_BODY_BYTES = 1_048_576;

/** Resolve everything that can fail before opening a socket or a tunnel. */
function configure(): { binary: string; port: number; channelSecret: string } {
  try {
    return {
      binary: resolveTunnelBinary({
        override: process.env.CLOUDFLARED_PATH,
        platform: process.platform,
        probe: canExecute,
      }),
      port: parseCapturePort(process.env.LINE_CAPTURE_PORT),
      // Fail here rather than after the tunnel is up: without the secret no
      // delivery can be authenticated, so there is nothing to wait for.
      channelSecret: required("LINE_CHANNEL_SECRET"),
    };
  } catch (err) {
    if (err instanceof TunnelBinaryUnavailableError) {
      process.stderr.write(`\n${err.message}\n\n`);
      process.exit(1);
    }
    throw err;
  }
}

const { binary, port, channelSecret } = configure();

/** Resolves with the first `source.userId` LINE delivers over an authenticated request. */
const captured = new Promise<string>((resolve, reject) => {
  const server = createServer((req, res) => {
    let body = "";
    let tooLarge = false;
    req.setEncoding("utf8");

    req.on("data", (chunk: string) => {
      if (tooLarge) return;
      if (body.length + chunk.length > MAX_BODY_BYTES) {
        tooLarge = true;
        body = "";
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on("end", () => {
      if (tooLarge) return;

      const decision = decideCapture({
        channelSecret,
        rawBody: body,
        signatureHeader: req.headers["x-line-signature"] as string | undefined,
      });

      if (decision.accepted) {
        // 200 so LINE does not retry a delivery we have already consumed.
        res.writeHead(200).end();
        server.close();
        resolve(decision.userId);
        return;
      }

      if (decision.reason === "bad_signature") {
        // NOT from LINE, or tampered with in flight. 401 rather than 200: this
        // URL is public while the tunnel is open, and answering OK to an
        // unauthenticated request is how the forged-id hole worked.
        res.writeHead(401).end();
        process.stdout.write("rejected an unauthenticated request — still waiting\n");
        return;
      }

      // Authenticated and genuinely from LINE, but not carrying an id: the
      // webhook-verification ping and group `leave` events look like this.
      res.writeHead(200).end();
      process.stdout.write(`delivery had no usable user id (${decision.reason}) — still waiting\n`);
    });

    req.on("error", (err) => {
      process.stdout.write(`request aborted: ${err.message}\n`);
    });
  });

  server.on("error", reject);
  server.listen(port, "127.0.0.1");
});

const tunnel = spawn(binary, ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"], {
  stdio: ["ignore", "pipe", "pipe"],
});

tunnel.on("error", (err) => {
  process.stderr.write(`could not start ${binary}: ${err.message}\n`);
  process.exit(1);
});

/** cloudflared prints the assigned hostname to stderr, framed in a banner. */
const publicUrl = await new Promise<string>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("cloudflared did not report a URL")), 45_000);
  const scan = (chunk: Buffer) => {
    const found = chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (found !== null) {
      clearTimeout(timer);
      resolve(found[0]);
    }
  };
  tunnel.stderr.on("data", scan);
  tunnel.stdout.on("data", scan);
});

process.stdout.write(
  [
    "",
    `Tunnel is up, backed by ${binary}. Two steps, then this finishes on its own:`,
    "",
    "  1. developers.line.biz → your channel → Messaging API → Webhook URL:",
    `       ${publicUrl}/webhook`,
    "     Save it and turn Use webhook ON.",
    "",
    "  2. Send the bot any message from LINE on your phone.",
    "",
    "Only deliveries carrying a valid LINE signature are accepted; this URL is",
    "public while the tunnel is open.",
    "",
    "waiting for a delivery…",
    "",
  ].join("\n"),
);

try {
  const userId = await captured;
  upsertEnvVar(ENV_PATH, "LINE_TEST_USER_ID", userId);

  process.stdout.write(
    [
      "",
      `LINE_TEST_USER_ID=${userId}`,
      "",
      "Written to integration/.env. Add the same value as a repository secret, then run:",
      "  pnpm --filter @theokit/gateway-integration exec vitest run tests/line",
      "",
      "The tunnel is gone; the id is permanent, so this never needs running again.",
      "",
    ].join("\n"),
  );
} finally {
  tunnel.kill();
}

process.exit(0);
