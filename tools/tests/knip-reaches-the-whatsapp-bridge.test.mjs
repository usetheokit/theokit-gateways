// The WhatsApp bridge is spawned as a subprocess (backend/web/index.ts resolves its path) and
// copied into dist by tsup, so knip's import graph never reaches it. It must be a declared entry.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BRIDGE = "src/bridge/whatsapp-web-bridge.mjs";

function undeclared(config, workspace, file) {
  const entries = config.workspaces?.[workspace]?.entry ?? [];
  return entries.includes(file)
    ? undefined
    : `${workspace} does not declare ${file} as a knip entry`;
}

describe("knip reaches the WhatsApp bridge", () => {
  it("declares_the_bridge_as_an_entry_of_its_workspace", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "knip.json"), "utf8"));
    expect(undeclared(config, "packages/gateway-whatsapp", BRIDGE)).toBeUndefined();
  });

  it("declares_the_other_files_knip_cannot_reach", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "knip.json"), "utf8"));
    expect(undeclared(config, "packages/gateway", "vitest.mutation.config.ts")).toBeUndefined();
    expect(
      undeclared(config, "packages/gateway-discord", "shims/types-node-26.d.ts"),
    ).toBeUndefined();
    expect(undeclared(config, "packages/gateway-teams", "tests/**/*.ts")).toBeUndefined();
    for (const [workspace, file] of [
      ["packages/gateway", "vitest.mutation.config.ts"],
      ["packages/gateway-discord", "shims/types-node-26.d.ts"],
    ]) {
      expect(existsSync(join(ROOT, workspace, file))).toBe(true);
    }
  });

  it("names_a_file_that_exists", () => {
    expect(existsSync(join(ROOT, "packages/gateway-whatsapp", BRIDGE))).toBe(true);
  });

  it("the_check_fails_without_the_declaration", () => {
    expect(undeclared({}, "packages/gateway-whatsapp", BRIDGE)).toContain("does not declare");
  });
});
