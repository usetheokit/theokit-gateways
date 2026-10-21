/**
 * Edit contract — what `BasePlatformAdapter.editMessage` and `supportsEdit` promise.
 *
 * The base answers for every adapter that cannot edit: `supportsEdit` is `false` and an edit is
 * refused as `edit_unsupported` naming the platform, with no platform call and no throw. A caller
 * reads the flag before it starts a preview and treats the refusal as "send instead".
 *
 * The probe below declares neither member, so every assertion reads the base default and not a
 * value the probe supplied.
 *
 * The second block reads the ten adapters' sources and holds which of them can edit. The core
 * cannot import its own dependents, and a test in each of the four non-edit packages would call a
 * base member that core 0.9.0, the floor of their peer range, does not have; a source scan holds
 * the six-of-ten split without either cost. It proves the declarations are present, not that the
 * edits work: each edit-capable package's `tests/edit-message.test.ts` proves that.
 *
 * @internal
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BasePlatformAdapter,
  type OutboundMessage,
  type SendResult,
} from "../../src/adapter/base.js";
import type { MessageEvent } from "../../src/types/message-event.js";

/** A stand-in for the platform SDK a real adapter holds. The base default never reaches it. */
interface FakePlatformClient {
  send(text: string): Promise<void>;
  edit(id: string, text: string): Promise<void>;
}

class NonEditProbe extends BasePlatformAdapter {
  override readonly platform = "sms" as const;
  readonly client: FakePlatformClient = {
    send: vi.fn(async () => undefined),
    edit: vi.fn(async () => undefined),
  };

  override async connect(): Promise<boolean> {
    return true;
  }

  override async disconnect(): Promise<void> {
    /* nothing to close */
  }

  override async sendMessage(out: OutboundMessage): Promise<SendResult> {
    await this.client.send(out.text);
    return { ok: true, messageId: "sent-1" };
  }

  override onInbound(_handler: (event: MessageEvent) => Promise<void>): () => void {
    return () => undefined;
  }

  override async deliver(_event: MessageEvent): Promise<"ok" | "no_handler" | "handler_threw"> {
    return "no_handler";
  }
}

const OUT: OutboundMessage = { channel: { id: "c", type: "dm" }, text: "hi" };

const UNSUPPORTED: SendResult = {
  ok: false,
  error: { code: "edit_unsupported", message: "sms adapter cannot edit a sent message" },
};

describe("BasePlatformAdapter edit default", () => {
  it("reports supportsEdit as false on an adapter that does not override it", () => {
    expect(new NonEditProbe().supportsEdit).toBe(false);
  });

  it("refuses an edit as edit_unsupported naming the platform", async () => {
    expect(await new NonEditProbe().editMessage("42", OUT)).toEqual(UNSUPPORTED);
  });

  it("makes no platform call when it refuses an edit", async () => {
    const probe = new NonEditProbe();
    const send = vi.spyOn(probe, "sendMessage");

    await probe.editMessage("42", OUT);

    expect(send).toHaveBeenCalledTimes(0);
    // The base cannot reach `client`, so these two hold by construction. They stay as the plan's
    // record that no SDK call is made; the `sendMessage` spy above is the assertion that can fail.
    expect(probe.client.send).toHaveBeenCalledTimes(0);
    expect(probe.client.edit).toHaveBeenCalledTimes(0);
  });

  it("answers capability before input, even with empty text and an empty id", async () => {
    const empty: OutboundMessage = { channel: { id: "", type: "dm" }, text: "" };
    await expect(new NonEditProbe().editMessage("", empty)).resolves.toEqual(UNSUPPORTED);
  });
});

const PACKAGES_DIR = join(__dirname, "..", "..", "..");

/** The six adapters whose platform has an edit call; the other four inherit the refusal. */
const EDIT_CAPABLE: ReadonlySet<string> = new Set([
  "gateway-discord",
  "gateway-matrix",
  "gateway-mattermost",
  "gateway-slack",
  "gateway-teams",
  "gateway-telegram",
]);

/** Every `gateway-*` package's `src/adapter.ts`, sorted by package name. */
async function adapterSources(): Promise<Array<{ pkg: string; source: string }>> {
  const entries = await readdir(PACKAGES_DIR, { withFileTypes: true });
  const out: Array<{ pkg: string; source: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("gateway-")) continue;
    const path = join(PACKAGES_DIR, entry.name, "src", "adapter.ts");
    try {
      out.push({ pkg: entry.name, source: await readFile(path, "utf8") });
    } catch (err) {
      // A gateway-* directory without src/adapter.ts is not an adapter package; any other
      // failure to read one is a real error.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return out.sort((a, b) => a.pkg.localeCompare(b.pkg));
}

const DECLARES_SUPPORTS_EDIT = /^\s+override readonly supportsEdit = true;/m;
const OVERRIDES_EDIT_MESSAGE = /^\s+override async editMessage\(/m;

describe("which adapters can edit", () => {
  it("reads the ten adapter sources", async () => {
    expect((await adapterSources()).map(({ pkg }) => pkg)).toHaveLength(10);
  });

  it("has exactly the six edit-capable adapters declare supportsEdit and override editMessage", async () => {
    const declaring: string[] = [];
    const overriding: string[] = [];
    for (const { pkg, source } of await adapterSources()) {
      if (DECLARES_SUPPORTS_EDIT.test(source)) declaring.push(pkg);
      if (OVERRIDES_EDIT_MESSAGE.test(source)) overriding.push(pkg);
    }
    expect(declaring).toEqual([...EDIT_CAPABLE].sort());
    expect(overriding).toEqual([...EDIT_CAPABLE].sort());
  });

  it("has the other four adapters name neither member", async () => {
    // The two regexes above match one spelling each, so a getter or an annotated field in a
    // non-edit adapter would slip past them; any mention of either name in those four is caught.
    const offenders = (await adapterSources())
      .filter(
        ({ pkg, source }) =>
          !EDIT_CAPABLE.has(pkg) && /\b(supportsEdit|editMessage)\b/.test(source),
      )
      .map(({ pkg }) => pkg);
    expect(offenders).toEqual([]);
  });

  it("has no adapter call super.editMessage", async () => {
    // Core 0.9.0, the floor of every adapter's peer range, has no base editMessage, so a super call
    // would be a TypeError there; each adapter answers its own refusals (plan D3).
    const offenders = (await adapterSources())
      .filter(({ source }) => source.includes("super.editMessage"))
      .map(({ pkg }) => pkg);
    expect(offenders).toEqual([]);
  });

  it("has Matrix's own refusal use the base default's code", async () => {
    const matrix = (await adapterSources()).find(({ pkg }) => pkg === "gateway-matrix");
    const base = await readFile(join(__dirname, "..", "..", "src", "adapter", "base.ts"), "utf8");
    expect(base).toContain('code: "edit_unsupported"');
    expect(matrix?.source).toContain('code: "edit_unsupported"');
  });
});
