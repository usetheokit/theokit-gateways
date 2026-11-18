import { mkdir, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFileCredentialStore, GatewayConfigurationError } from "../src/index.js";

async function dir() {
  return mkdtemp(join(tmpdir(), "cred-"));
}

describe("createFileCredentialStore", () => {
  it("sets, gets, replaces, with mode 0600", async () => {
    const d = await dir();
    const s = createFileCredentialStore(d);
    await s.set("x-refresh-token:1", "a");
    expect(await s.get("x-refresh-token:1")).toBe("a");
    expect((await stat(join(d, "x-refresh-token%3A1"))).mode & 0o777).toBe(0o600);
    await s.set("x-refresh-token:1", "b");
    expect(await s.get("x-refresh-token:1")).toBe("b");
  });

  it("returns undefined for a missing key", async () => {
    expect(await createFileCredentialStore(await dir()).get("nope")).toBeUndefined();
  });

  it("throws credential_store_unreadable on another read error", async () => {
    const d = await dir();
    await mkdir(join(d, "k"));
    const err = await createFileCredentialStore(d)
      .get("k")
      .catch((e) => e);
    expect(err).toBeInstanceOf(GatewayConfigurationError);
    expect(err.code).toBe("credential_store_unreadable");
    expect(err.message).toContain(join(d, "k"));
  });

  it("rejects invalid keys", async () => {
    const s = createFileCredentialStore(await dir());
    await expect(s.set("../x", "v")).rejects.toMatchObject({ code: "invalid_credential_key" });
    for (const k of ["token\n", "token\r", "token\u2028"])
      await expect(s.set(k, "v")).rejects.toMatchObject({ code: "invalid_credential_key" });
    await s.set("...", "dots");
    expect(await s.get("...")).toBe("dots");
    await expect(s.get("..")).rejects.toMatchObject({ code: "invalid_credential_key" });
  });
});
