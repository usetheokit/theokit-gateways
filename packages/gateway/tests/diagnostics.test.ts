import { afterEach, describe, expect, it, vi } from "vitest";
import { reportDiagnostic } from "../src/diagnostics.js";
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
});
