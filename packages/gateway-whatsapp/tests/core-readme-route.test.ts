/**
 * The WhatsApp Cloud route in the core gateway README, run as written (minus the theokit wiring).
 * The snippet's `onMessage` must deliver through the adapter's rules: a message addressed to
 * another phone number, or from a blocked sender, is dropped.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const README = join(PACKAGE_DIR, "..", "gateway", "README.md");
type OnMessage = (m: { payload: unknown }) => Promise<void>;
const dirs: string[] = [];

async function loadOnMessage(allowed: string | undefined): Promise<OnMessage> {
  const readme = readFileSync(README, "utf8");
  const section = readme.split(/^### /m).find((p) => p.startsWith("WhatsApp, since"));
  const block = /```ts\n([\s\S]*?)```/.exec(section ?? "")?.[1];
  if (block === undefined) throw new Error("core README has no WhatsApp ts block");
  const source = block
    .split("\n")
    .filter((l) => !/^import .* from "theokit\//.test(l))
    .join("\n");
  const cut = source.slice(0, source.indexOf("const handle"));
  const target = JSON.stringify(join(PACKAGE_DIR, "src", "index.ts"));
  const dir = mkdtempSync(join(tmpdir(), "core-readme-route-"));
  dirs.push(dir);
  const file = join(dir, "route.ts");
  writeFileSync(
    file,
    `// biome-ignore-all lint: generated from README.md\n${cut.replace('from "@theokit/gateway-whatsapp"', `from ${target}`)}\nexport { onMessage };`,
  );
  process.env.WHATSAPP_ACCESS_TOKEN = "t";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "PNID";
  process.env.META_APP_SECRET = "s";
  if (allowed === undefined) delete process.env.WHATSAPP_ALLOWED;
  else process.env.WHATSAPP_ALLOWED = allowed;
  return ((await import(/* @vite-ignore */ file)) as { onMessage: OnMessage }).onMessage;
}

function payload(from: string, phoneNumberId: string): unknown {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: "S" }, wa_id: from }],
              messages: [
                { from, id: `wamid.${from}`, timestamp: "1", type: "text", text: { body: "hi" } },
              ],
            },
          },
        ],
      },
    ],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("the WhatsApp route in the core gateway README", () => {
  it("delivers a message for its own number", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const onMessage = await loadOnMessage(undefined);
    await onMessage({ payload: payload("5511999999999", "PNID") });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("drops a message addressed to a foreign phone number", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const onMessage = await loadOnMessage(undefined);
    await onMessage({ payload: payload("5511999999999", "OTHER") });
    expect(log).not.toHaveBeenCalled();
  });

  it("drops a message from a sender outside the allowlist", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const onMessage = await loadOnMessage("5511111111111");
    await onMessage({ payload: payload("5511999999999", "PNID") });
    expect(log).not.toHaveBeenCalled();
  });
});
