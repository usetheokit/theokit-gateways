/**
 * Every adapter answers `out.attachments`: Telegram sends them, every other one refuses (B-674).
 *
 * The probe below declares no `supportsAttachments`, so the first assertion reads the base default.
 * The rest is a source scan, the way `adapter-edit-contract.test.ts` holds `supportsEdit`: the core
 * cannot import its own dependents. The refusal is one shape in every package, the delegation
 * `return refuseAttachments(out) ?? this.<method>(...)` as the first statement of `sendMessage` and
 * of every `editMessage` override, so one regex holds all of them and a copy that drifts is named.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BasePlatformAdapter,
  type OutboundMessage,
  type SendResult,
} from "../../src/adapter/base.js";
import type { MessageEvent } from "../../src/types/message-event.js";

class AttachmentProbe extends BasePlatformAdapter {
  override readonly platform = "sms" as const;

  override async connect(): Promise<boolean> {
    return true;
  }

  override async disconnect(): Promise<void> {
    /* nothing to close */
  }

  override async sendMessage(_out: OutboundMessage): Promise<SendResult> {
    return { ok: true, messageId: "sent-1" };
  }

  override onInbound(_handler: (event: MessageEvent) => Promise<void>): () => void {
    return () => undefined;
  }

  override async deliver(_event: MessageEvent): Promise<"ok" | "no_handler" | "handler_threw"> {
    return "no_handler";
  }
}

const PACKAGES_DIR = join(__dirname, "..", "..", "..");

/** The one adapter whose platform send takes images. */
const SENDS_ATTACHMENTS = "gateway-telegram";

const DECLARES_SUPPORTS_ATTACHMENTS = /^\s+override readonly supportsAttachments = true;/m;
const SEND_DECLARATION = /^\s+(?:override )?async sendMessage\(out: OutboundMessage\)[^{]*\{/m;
const EDIT_DECLARATION =
  /^\s+override async editMessage\(messageId: string, out: OutboundMessage\)[^{]*\{/m;
const OPENS_WITH_REFUSAL = /^\s*return refuseAttachments\(out\) \?\? this\.\w+\(/;

interface AdapterPackage {
  readonly pkg: string;
  readonly adapter: string;
  readonly helper: string | undefined;
}

/** Every `gateway-*` package's `src/adapter.ts` and `src/refuse-attachments.ts`, by package name. */
async function adapterPackages(): Promise<AdapterPackage[]> {
  const entries = await readdir(PACKAGES_DIR, { withFileTypes: true });
  const found: AdapterPackage[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("gateway-")) continue;
    const adapter = await readOptional(join(PACKAGES_DIR, entry.name, "src", "adapter.ts"));
    if (adapter === undefined) continue;
    const helper = await readOptional(
      join(PACKAGES_DIR, entry.name, "src", "refuse-attachments.ts"),
    );
    found.push({ pkg: entry.name, adapter, helper });
  }
  return found.sort((a, b) => a.pkg.localeCompare(b.pkg));
}

/** A file's text, or `undefined` when it does not exist; any other read failure is thrown. */
async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return undefined;
  }
}

/** The first statement after the declaration `declaration` matches, or `undefined` without one. */
function firstStatementOf(source: string, declaration: RegExp): string | undefined {
  const match = declaration.exec(source);
  if (match === null) return undefined;
  const rest = source.slice(match.index + match[0].length);
  return rest.split("\n").find((line) => line.trim().length !== 0);
}

/** Why the method `declaration` matches does not open with the refusal, or `undefined`. */
function refusalVerdict(source: string, declaration: RegExp): string | undefined {
  const first = firstStatementOf(source, declaration);
  if (first === undefined) return "no declaration found";
  return OPENS_WITH_REFUSAL.test(first) ? undefined : `opens with: ${first.trim()}`;
}

describe("the attachment contract", () => {
  it("the base declares supportsAttachments false", () => {
    expect(new AttachmentProbe().supportsAttachments).toBe(false);
  });

  it("reads every adapter package", async () => {
    expect(await adapterPackages()).toHaveLength(20);
  });

  it("exactly one package declares supportsAttachments true", async () => {
    const declaring = (await adapterPackages())
      .filter(({ adapter }) => DECLARES_SUPPORTS_ATTACHMENTS.test(adapter))
      .map(({ pkg }) => pkg);
    expect(declaring).toEqual([SENDS_ATTACHMENTS]);
  });

  it("every other adapter's sendMessage opens with refuseAttachments", async () => {
    const refusing = (await adapterPackages()).filter(({ pkg }) => pkg !== SENDS_ATTACHMENTS);
    const offenders = refusing
      .map(({ pkg, adapter }) => ({ pkg, why: refusalVerdict(adapter, SEND_DECLARATION) }))
      .filter(({ why }) => why !== undefined);
    expect(refusing).toHaveLength(19);
    expect(offenders).toEqual([]);
  });

  it("every editMessage override opens with refuseAttachments", async () => {
    const editing = (await adapterPackages()).filter(({ adapter }) =>
      EDIT_DECLARATION.test(adapter),
    );
    const offenders = editing
      .map(({ pkg, adapter }) => ({ pkg, why: refusalVerdict(adapter, EDIT_DECLARATION) }))
      .filter(({ why }) => why !== undefined);
    expect(editing).toHaveLength(6);
    expect(offenders).toEqual([]);
  });

  it("every package defines refuseAttachments with attachments_unsupported", async () => {
    const offenders = (await adapterPackages())
      .filter(
        ({ helper }) =>
          helper === undefined ||
          !helper.includes("export function refuseAttachments") ||
          !helper.includes('"attachments_unsupported"'),
      )
      .map(({ pkg }) => pkg);
    expect(offenders).toEqual([]);
  });
});
