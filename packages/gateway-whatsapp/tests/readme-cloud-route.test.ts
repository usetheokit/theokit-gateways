/**
 * The Cloud route the README documents, executed as written.
 *
 * Integrators copy that snippet, and nothing else ran it: a redelivery that arrived while a slow
 * handler was still running delivered the same message twice, and no test could see it. This file
 * extracts the first `ts` block of the README, points its import at this package's source, and
 * drives the route it defines, so the snippet and its behaviour cannot drift apart.
 */

import * as crypto from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { WhatsAppMessageEvent } from "@theokit/gateway";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLOUD = { accessToken: "t", phoneNumberId: "PNID", appSecret: "route-secret" } as const;

type OnWebhook = (rawBody: string, signature: string | undefined) => Promise<number>;

/** The README's first `ts` block: the documented Cloud route. */
function readmeRouteSource(): string {
  const readme = readFileSync(join(PACKAGE_DIR, "README.md"), "utf8");
  const match = /```ts\n([\s\S]*?)```/.exec(readme);
  if (match === null) throw new Error("README.md has no ts code block");
  return match[1] as string;
}

const tempDirs: string[] = [];

/**
 * Load a fresh copy of the README route, so each test gets its own adapter and its own record of
 * delivered messages. `cloud` and `handleMessage` are the two names the snippet leaves to the host.
 */
async function loadRoute(
  handleMessage: (event: WhatsAppMessageEvent) => Promise<void>,
): Promise<OnWebhook> {
  const source = readmeRouteSource();
  const importTarget = JSON.stringify(join(PACKAGE_DIR, "src", "index.ts"));
  if (!source.includes('from "@theokit/gateway-whatsapp"')) {
    throw new Error("the README route no longer imports from @theokit/gateway-whatsapp");
  }
  const dir = mkdtempSync(join(tmpdir(), "whatsapp-readme-route-"));
  tempDirs.push(dir);
  const file = join(dir, "route.ts");
  writeFileSync(
    file,
    [
      "// biome-ignore-all lint: generated from README.md",
      "const { cloud, handleMessage } = (globalThis as any).__whatsappReadmeRoute;",
      source.replace('from "@theokit/gateway-whatsapp"', `from ${importTarget}`),
      "export { onWebhook };",
    ].join("\n"),
  );
  (globalThis as Record<string, unknown>).__whatsappReadmeRoute = { cloud: CLOUD, handleMessage };
  const loaded = (await import(/* @vite-ignore */ file)) as { onWebhook: OnWebhook };
  return loaded.onWebhook;
}

function signedBody(wamid: string): { body: string; signature: string } {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: "PNID" },
              contacts: [{ profile: { name: "Sender" }, wa_id: "5511999999999" }],
              messages: [
                {
                  from: "5511999999999",
                  id: wamid,
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: "hello" },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const hex = crypto.createHmac("sha256", CLOUD.appSecret).update(body).digest("hex");
  return { body, signature: `sha256=${hex}` };
}

beforeEach(() => {
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).__whatsappReadmeRoute;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the Cloud route documented in README.md", () => {
  it("delivers a redelivery that arrives while the first delivery is still running only once", async () => {
    let release: () => void = () => {};
    const handlerGate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const received: string[] = [];
    const onWebhook = await loadRoute(async (event) => {
      received.push(event.id);
      await handlerGate;
    });
    const { body, signature } = signedBody("wamid.slow");

    const first = onWebhook(body, signature);
    await vi.waitFor(() => expect(received).toEqual(["wamid.slow"]));
    const redelivery = onWebhook(body, signature);
    // Give the redelivery every chance to reach the handler before the first one finishes.
    await new Promise((resolveTick) => setTimeout(resolveTick, 20));
    release();

    expect(await Promise.all([first, redelivery])).toEqual([200, 200]);
    expect(received).toEqual(["wamid.slow"]);
  });

  it("delivers a message again on the retry after its handler failed", async () => {
    let calls = 0;
    const onWebhook = await loadRoute(async () => {
      calls += 1;
      if (calls === 1) throw new Error("handler failed once");
    });
    const { body, signature } = signedBody("wamid.retry");

    const firstStatus = await onWebhook(body, signature);
    const retryStatus = await onWebhook(body, signature);

    expect([firstStatus, retryStatus]).toEqual([503, 200]);
    expect(calls).toBe(2);
  });

  it("does not deliver a message twice once it was delivered", async () => {
    const received: string[] = [];
    const onWebhook = await loadRoute(async (event) => {
      received.push(event.id);
    });
    const { body, signature } = signedBody("wamid.done");

    const statuses = [await onWebhook(body, signature), await onWebhook(body, signature)];

    expect(statuses).toEqual([200, 200]);
    expect(received).toEqual(["wamid.done"]);
  });

  it("refuses a body whose signature does not match", async () => {
    const received: string[] = [];
    const onWebhook = await loadRoute(async (event) => {
      received.push(event.id);
    });
    const { body } = signedBody("wamid.forged");

    expect(await onWebhook(body, `sha256=${"0".repeat(64)}`)).toBe(401);
    expect(received).toEqual([]);
  });
});
