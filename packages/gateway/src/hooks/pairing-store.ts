/**
 * File-backed pairing store: senders approved by an owner are kept in `pairing.json`.
 * Pending codes live in memory for one hour.
 *
 * @public
 */

import { randomInt, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GatewayConfigurationError } from "../errors/config-error.js";

/** Pairing store used by the access policy hook. */
export interface PairingStore {
  /** A 6-digit code for the sender; the same code while one is pending. */
  issue(platform: string, senderId: string): string;
  approve(
    code: string,
  ): Promise<
    | { ok: true; platform: string; senderId: string }
    | { ok: false; reason: "unknown_or_expired" | "write_failed" }
  >;
  isPaired(platform: string, senderId: string): boolean;
}

/** `<platform>:<senderId>`; email ids compare case-insensitively. */
export function senderKey(platform: string, senderId: string): string {
  return `${platform}:${platform === "email" ? senderId.toLowerCase() : senderId}`;
}

const TTL_MS = 3_600_000;
const FILE = "pairing.json";

function unreadable(): GatewayConfigurationError {
  return new GatewayConfigurationError("gateway", {
    code: "pairing_store_unreadable",
    message: "gateway: pairing_store_unreadable",
  });
}

function load(path: string): Set<string> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw unreadable();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw unreadable();
  }
  const list = (parsed as { paired?: unknown } | null)?.paired;
  if (!Array.isArray(list) || !list.every((x) => typeof x === "string")) throw unreadable();
  return new Set(list as string[]);
}

/** Creates a store persisted in `<dir>/pairing.json` (mode 0600). */
export function createFilePairingStore(options: {
  dir: string;
  clock?: () => number;
  random?: (min: number, max: number) => number;
}): PairingStore {
  const clock = options.clock ?? Date.now;
  const random = options.random ?? randomInt;
  const path = join(options.dir, FILE);
  const paired = load(path);
  const pending = new Map<string, { platform: string; senderId: string; expires: number }>();
  let chain: Promise<unknown> = Promise.resolve();

  const prune = (): void => {
    const now = clock();
    for (const [code, p] of pending) if (p.expires <= now) pending.delete(code);
  };

  function persist(next: Set<string>): void {
    mkdirSync(options.dir, { recursive: true });
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify({ paired: [...next].sort((a, b) => a.localeCompare(b)) }), {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(tmp, path);
  }

  return {
    issue(platform, senderId) {
      prune();
      for (const [code, p] of pending) {
        if (senderKey(p.platform, p.senderId) === senderKey(platform, senderId)) return code;
      }
      let code: string;
      do {
        code = String(random(100000, 1000000));
      } while (pending.has(code));
      pending.set(code, { platform, senderId, expires: clock() + TTL_MS });
      return code;
    },
    approve(code) {
      const run = async () => {
        prune();
        const p = pending.get(code);
        if (!p) return { ok: false as const, reason: "unknown_or_expired" as const };
        const next = new Set(paired);
        next.add(senderKey(p.platform, p.senderId));
        try {
          persist(next);
        } catch {
          return { ok: false as const, reason: "write_failed" as const };
        }
        paired.add(senderKey(p.platform, p.senderId));
        pending.delete(code);
        return { ok: true as const, platform: p.platform, senderId: p.senderId };
      };
      const result = chain.then(run, run);
      chain = result.catch(() => undefined);
      return result;
    },
    isPaired(platform, senderId) {
      return paired.has(senderKey(platform, senderId));
    },
  };
}
