/**
 * The "Your own route" example the README documents, executed as written.
 *
 * Integrators copy that snippet, and until this file nothing ran it: the reason-to-status mapping
 * and the log lines lived only in prose. This file extracts the README's first `ts` block, points
 * its import at a shim over this package's source, and drives the route it defines, so the snippet
 * and its behaviour cannot drift apart.
 *
 * The shim changes one thing: it adds the test's options to every `teamsActivityVerifier` call, so
 * the README's `teamsActivityVerifier({ clientId })` reads the key set from a local key server
 * instead of Microsoft's, and, for the one case that needs it, loads a validator module that
 * exports no validator. The snippet's text is not edited.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { MessageEvent } from "@theokit/gateway";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamsAdapter } from "../src/adapter.js";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, SERVICE_URL, startKeyServer } from "./helpers/key-server.js";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type OnTeamsRequest = (request: Request) => Promise<Response>;

/** The README's first `ts` block: the documented route. */
function readmeRouteSource(): string {
  const readme = readFileSync(join(PACKAGE_DIR, "README.md"), "utf8");
  const match = /```ts\n([\s\S]*?)```/.exec(readme);
  if (match === null) throw new Error("README.md has no ts code block");
  return match[1] as string;
}

const tempDirs: string[] = [];

/**
 * Load a fresh copy of the README route. `clientId`, `clientSecret` and `tenantId` are the names
 * the snippet leaves to the host; `verifierOptions` is what the shim adds to the verifier's.
 */
async function loadRoute(verifierOptions: Record<string, unknown>): Promise<OnTeamsRequest> {
  const source = readmeRouteSource();
  if (!source.includes('from "@theokit/gateway-teams"')) {
    throw new Error("the README route no longer imports from @theokit/gateway-teams");
  }
  if (!source.includes("export async function onTeamsRequest(")) {
    throw new Error("the README route no longer exports onTeamsRequest");
  }
  const dir = mkdtempSync(join(tmpdir(), "teams-readme-route-"));
  tempDirs.push(dir);
  const index = JSON.stringify(join(PACKAGE_DIR, "src", "index.ts"));
  const shim = join(dir, "shim.ts");
  writeFileSync(
    shim,
    [
      "// biome-ignore-all lint: test shim over the package source",
      `import * as real from ${index};`,
      `export * from ${index};`,
      "export function teamsActivityVerifier(options: any) {",
      "  const extra = (globalThis as any).__teamsReadmeRoute.verifierOptions;",
      "  return real.teamsActivityVerifier({ ...options, ...extra });",
      "}",
    ].join("\n"),
  );
  const file = join(dir, "route.ts");
  writeFileSync(
    file,
    [
      "// biome-ignore-all lint: generated from README.md",
      "const { clientId, clientSecret, tenantId } = (globalThis as any).__teamsReadmeRoute;",
      source.replace('from "@theokit/gateway-teams"', `from ${JSON.stringify(shim)}`),
    ].join("\n"),
  );
  (globalThis as Record<string, unknown>).__teamsReadmeRoute = {
    clientId: CLIENT_ID,
    clientSecret: "route-secret",
    tenantId: "00000000-0000-0000-0000-00000000aaaa",
    verifierOptions,
  };
  const loaded = (await import(/* @vite-ignore */ file)) as { onTeamsRequest: OnTeamsRequest };
  return loaded.onTeamsRequest;
}

/** Every line the route wrote through `console.warn` and `console.error`, joined per call. */
function loggedLines(): string[] {
  return [vi.mocked(console.warn), vi.mocked(console.error)].flatMap((spy) =>
    spy.mock.calls.map((args) => args.map(String).join(" ")),
  );
}

describe("the route documented in README.md", () => {
  let ks: KeyServer;
  let delivered: MessageEvent[];

  beforeEach(async () => {
    ks = await startKeyServer();
    delivered = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(TeamsAdapter.prototype, "deliver").mockImplementation(async (event) => {
      delivered.push(event);
      return "ok";
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await ks.close();
    delete (globalThis as Record<string, unknown>).__teamsReadmeRoute;
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("answers 200 and delivers the normalized activity when the token verifies", async () => {
    const onTeamsRequest = await loadRoute({ cloud: ks.cloud });
    const activity = {
      type: "message",
      id: "activity-1",
      text: "hello",
      serviceUrl: SERVICE_URL,
      channelId: "msteams",
      from: { id: "user-1", name: "User" },
      conversation: { id: "conversation-1" },
      recipient: { id: "bot-1" },
    };

    const response = await onTeamsRequest(activityRequest(ks.signToken({}), activity));

    expect(response.status).toBe(200);
    expect(delivered.map((event) => event.text)).toEqual(["hello"]);
    expect(loggedLines()).toEqual([]);
  });

  it("answers a forged token with 401 and logs its reason without the token", async () => {
    const onTeamsRequest = await loadRoute({ cloud: ks.cloud });
    const forged = ks.otherKeySign({});

    const response = await onTeamsRequest(activityRequest(forged));

    expect([response.status, await response.text()]).toEqual([401, "invalid_token"]);
    expect(delivered).toEqual([]);
    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("invalid_token");
    expect(lines[0]).not.toContain(forged);
  });

  it("answers a body that is not an activity with 400 and logs its reason", async () => {
    const onTeamsRequest = await loadRoute({ cloud: ks.cloud });

    const response = await onTeamsRequest(activityRequest(ks.signToken({}), "not json"));

    expect(response.status).toBe(400);
    expect(loggedLines()).toEqual([expect.stringContaining("malformed_body")]);
  });

  it("answers a key set it cannot read with 503 and logs which set failed", async () => {
    const onTeamsRequest = await loadRoute({ cloud: ks.cloud });
    ks.failNext(503);

    const response = await onTeamsRequest(activityRequest(ks.signToken({})));

    expect(response.status).toBe(503);
    expect(loggedLines()).toEqual([
      expect.stringMatching(/key_set_unavailable.*Bot Framework key set .*HTTP 503/),
    ]);
  });

  it("answers a validator that cannot load with 503 and logs why", async () => {
    const onTeamsRequest = await loadRoute({ cloud: ks.cloud, __validatorModule: {} });

    const response = await onTeamsRequest(activityRequest(ks.signToken({})));

    expect(response.status).toBe(503);
    expect(loggedLines()).toEqual([expect.stringMatching(/validator_unavailable.*found neither/)]);
  });

  it("answers a body something read before the route with 500 and logs the fix", async () => {
    const onTeamsRequest = await loadRoute({ cloud: ks.cloud });
    const request = activityRequest(ks.signToken({}));
    await request.text();

    const response = await onTeamsRequest(request);

    expect(response.status).toBe(500);
    expect(loggedLines()).toEqual([
      expect.stringMatching(/body_already_read.*pass the verifier an unread request/),
    ]);
    expect(ks.hits()).toBe(0);
  });
});
