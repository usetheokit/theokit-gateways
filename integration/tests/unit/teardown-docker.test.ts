// What `teardown-docker.ts` removes from `.env`, and what it must leave alone.
//
// The script resolves `.env` next to its own directory, so each test copies it into a temporary
// tree (`<tmp>/scripts/teardown-docker.ts`, `<tmp>/.env`) and runs that copy: the real
// `integration/.env` is never read or written. A `docker` stub first on PATH records its arguments
// and exits 0, so no container is touched either.

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "..", "..", "scripts", "teardown-docker.ts");
const TSX = join(import.meta.dirname, "..", "..", "node_modules", ".bin", "tsx");

const trees: string[] = [];

afterEach(() => {
  for (const tree of trees.splice(0)) rmSync(tree, { recursive: true, force: true });
});

/** A temporary copy of the script with `env` as its `.env`, and a recording `docker` stub. */
function tree(env: string): { root: string; envPath: string; dockerLog: string } {
  const root = mkdtempSync(join(tmpdir(), "teardown-docker-"));
  trees.push(root);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "bin"));
  copyFileSync(SCRIPT, join(root, "scripts", "teardown-docker.ts"));
  const envPath = join(root, ".env");
  writeFileSync(envPath, env);
  const dockerLog = join(root, "docker-args.txt");
  const docker = join(root, "bin", "docker");
  writeFileSync(docker, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${dockerLog}'\nexit 0\n`);
  chmodSync(docker, 0o755);
  return { root, envPath, dockerLog };
}

function run(root: string, platform: string): { status: number | null; stderr: string } {
  const result = spawnSync(TSX, [join(root, "scripts", "teardown-docker.ts"), platform], {
    encoding: "utf8",
    // A hung tsx would block the event loop, and vitest's own timeout could not fire.
    timeout: 20_000,
    env: { ...process.env, PATH: `${join(root, "bin")}${delimiter}${process.env.PATH ?? ""}` },
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stderr: result.stderr };
}

const ENV = [
  "# provisioned by the bootstrap scripts",
  "MATRIX_ACCESS_TOKEN=matrix-token",
  "",
  "NEXTCLOUD_TALK_URL=http://localhost:28080",
  "NEXTCLOUD_TALK_BOT_SECRET=talk-secret",
  "NEXTCLOUD_TALK_ROOM=uau7bvcd",
  "TELEGRAM_BOT_TOKEN=telegram-token",
  "",
].join("\n");

describe("teardown-docker", () => {
  it("nextcloud-talk teardown clears only NEXTCLOUD_TALK_ lines", () => {
    const { root, envPath, dockerLog } = tree(ENV);

    const { status } = run(root, "nextcloud-talk");

    expect(status).toBe(0);
    expect(readFileSync(envPath, "utf8")).toBe(
      [
        "# provisioned by the bootstrap scripts",
        "MATRIX_ACCESS_TOKEN=matrix-token",
        "",
        "TELEGRAM_BOT_TOKEN=telegram-token",
        "",
      ].join("\n"),
    );
    expect(readFileSync(dockerLog, "utf8")).toContain(
      join("docker", "nextcloud-talk", "docker-compose.yml"),
    );
  });

  it("an unknown platform exits 1 and leaves the env file byte-identical", () => {
    const { root, envPath, dockerLog } = tree(ENV);

    const { status, stderr } = run(root, "signal");

    expect(status).toBe(1);
    expect(stderr).toContain("usage: teardown-docker.ts");
    expect(readFileSync(envPath, "utf8")).toBe(ENV);
    expect(existsSync(dockerLog)).toBe(false);
  });
});
