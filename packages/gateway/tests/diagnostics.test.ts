import { afterEach, describe, expect, it, vi } from "vitest";
import { reportDiagnostic, reportDiagnosticLine } from "../src/diagnostics.js";
import { createAccessPolicyHook } from "../src/hooks/access-policy.js";
import type { MessageEvent } from "../src/types/message-event.js";
import { MockAdapter } from "./adapter/mock-adapter.js";

const secret = ["syt", "dGhlb2tpdA", "ZxWvUtSrQpOnMlKjIhGf", "3AbCdE"].join("_");

const spy = () => vi.spyOn(process.stderr, "write").mockImplementation(() => true);
afterEach(() => vi.restoreAllMocks());

describe("reportDiagnostic", () => {
  it("prefixes the tag, ends the line, and redacts the message", () => {
    const stderr = spy();
    reportDiagnostic("gateway-x", `connect failed: ${secret}`);
    const out = stderr.mock.calls.map(String).join("");
    expect(out.startsWith("[gateway-x] connect failed: ")).toBe(true);
    expect(out.endsWith("\n")).toBe(true);
    expect(out).not.toContain("ZxWvUt");
  });

  it("writes a non-secret message unchanged", () => {
    const stderr = spy();
    reportDiagnostic("t", "plain", { failure: true });
    expect(stderr).toHaveBeenCalledWith("[t] plain\n");
  });

  it("redacts a secret in an error thrown by a handler run by BasePlatformAdapter", async () => {
    const stderr = spy();
    const adapter = new MockAdapter("telegram");
    adapter.onInbound(async () => {
      throw new Error(`boom ${secret}`);
    });
    const outcome = await adapter.deliver({ id: "e1", text: "hi" } as unknown as MessageEvent);
    expect(outcome).toBe("handler_threw");
    const out = stderr.mock.calls.map(String).join("");
    expect(out).toContain("[telegram] handler threw: boom");
    expect(out).not.toContain("ZxWvUt");
  });

  it("redacts a whole line written through the line path", () => {
    const stderr = spy();
    reportDiagnosticLine(`[gateway] x: ${secret}`);
    const out = stderr.mock.calls.map(String).join("");
    expect(out.startsWith("[gateway] x: ")).toBe(true);
    expect(out).not.toContain("ZxWvUt");
  });

  it("redacts the default sink of the access-policy hook", async () => {
    const stderr = spy();
    const hook = createAccessPolicyHook({
      owners: new Set(["telegram:1"]),
      isAuthenticated: () => true,
      dm: "pairing",
      pairing: {
        issue() {
          throw new Error(`boom ${secret}`);
        },
        approve: async () => ({ ok: false, reason: "write_failed" }),
        isPaired: () => false,
      },
    } as never);
    await hook.pre_inbound?.({
      event: {
        platform: "telegram",
        sender: { id: "2" },
        channel: { id: "c", type: "dm" },
        text: "hi",
      },
    } as never);
    const out = stderr.mock.calls.map(String).join("");
    expect(out).toContain("access-policy: hook failed");
    expect(out).not.toContain("ZxWvUt");
  });
});
