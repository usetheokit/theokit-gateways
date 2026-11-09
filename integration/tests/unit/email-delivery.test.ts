import { afterEach, expect, it, vi } from "vitest";
import { waitForEmail } from "../../src/email-delivery.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("accepts delivery beyond the former two-minute limit and records latency", async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const inbox = ["unrelated"];
  const result = waitForEmail(inbox, "probe");
  await vi.advanceTimersByTimeAsync(122_000);
  inbox.push("probe inbound");
  await vi.advanceTimersByTimeAsync(2_000);
  await expect(result).resolves.toBe("probe inbound");
  expect(log).toHaveBeenCalledWith(expect.stringContaining("124000ms since SMTP acceptance"));
});

it("fails after five minutes with marker and elapsed time", async () => {
  vi.useFakeTimers();
  const result = waitForEmail([], "missing-probe");
  const assertion = expect(result).rejects.toThrow(
    "email inbound missing-probe: no matching message observed after 300000ms since SMTP acceptance",
  );
  await vi.advanceTimersByTimeAsync(300_000);
  await assertion;
});
