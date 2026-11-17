/**
 * A small key/value store for credentials an adapter must keep across restarts, such as a rotated
 * OAuth refresh token.
 *
 * @public
 */

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GatewayConfigurationError } from "../errors/config-error.js";

/** Reads and writes one string credential per key. @public */
export interface CredentialStore {
  /** The stored value, or `undefined` when the key was never set. */
  get(key: string): Promise<string | undefined>;
  /** Store `value` under `key`, replacing any earlier value. */
  set(key: string, value: string): Promise<void>;
}

const KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

function fileFor(dir: string, key: string): string {
  // A key of only dots would name the directory itself or its parent.
  if (!KEY_PATTERN.test(key) || /^\.+$/.test(key)) {
    throw new GatewayConfigurationError("gateway", {
      code: "invalid_credential_key",
      message: `gateway: invalid_credential_key (keys match [A-Za-z0-9._:-]+): ${JSON.stringify(key)}`,
    });
  }
  return join(dir, key.replaceAll(":", "%3A"));
}

/** One file per key under `dir`, mode 0600, written to a temp file and renamed. @public */
export function createFileCredentialStore(dir: string): CredentialStore {
  return {
    async get(key) {
      const path = fileFor(dir, key);
      try {
        return await readFile(path, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw new GatewayConfigurationError("gateway", {
          code: "credential_store_unreadable",
          message: `gateway: credential_store_unreadable: ${path}`,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    },
    async set(key, value) {
      const path = fileFor(dir, key);
      await mkdir(dir, { recursive: true });
      const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        await writeFile(tmp, value, { mode: 0o600 });
        await chmod(tmp, 0o600);
        await rename(tmp, path);
      } catch (err) {
        await unlink(tmp).catch(() => undefined);
        throw err;
      }
    },
  };
}
