/**
 * The README's "Editing a sent message" sample, compiled and checked against the README.
 *
 * `pnpm quality:doc-api` checks only the names a README `import` statement names; it discards the
 * sample's body, so it cannot see `supportsEdit` or `editMessage`. Here the sample is real code:
 * the core's `tsc --noEmit` compiles it (this file is under `tests/`), and the first test fails
 * when the README block and the source region below differ. A README that names a member the core
 * lacks no longer compiles, and a sample edited in one place only no longer matches.
 *
 * @internal
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BasePlatformAdapter, OutboundMessage, SendResult } from "../../src/adapter/base.js";
import { MockAdapter } from "../adapter/mock-adapter.js";

/**
 * An adapter that says it can edit and whose edit is refused.
 *
 * The refusal is the base default's `edit_unsupported`, the code Matrix answers when its injected
 * client has no `sendMessage`: a flag of `true` does not promise that every edit is accepted. The
 * sample treats every refusal alike, so this also stands for a platform refusing the edit, and it
 * keeps the test running the core's own edit code rather than a refusal written here.
 */
class RefusingEditAdapter extends MockAdapter {
  override readonly supportsEdit = true;
}

// readme-sample:start
async function sendWithPreview(
  adapter: BasePlatformAdapter,
  out: OutboundMessage,
  preview: string,
): Promise<SendResult> {
  // No edit call on this platform: send the final text once.
  if (!adapter.supportsEdit) return adapter.sendMessage(out);
  const sent = await adapter.sendMessage({ ...out, text: preview });
  if (!sent.ok || sent.messageId === undefined) return adapter.sendMessage(out);
  // The preview must fit one message; edit_too_long and every other refusal fall back to a send.
  const edited = await adapter.editMessage(sent.messageId, out);
  return edited.ok ? edited : adapter.sendMessage(out);
}
// readme-sample:end

const START = "// readme-sample:start\n";
const END = "// readme-sample:end";

/** The fenced `typescript` block under the README's `## Editing a sent message` heading. */
function readmeSample(readme: string): string | undefined {
  const section = readme.split(/^## /m).find((part) => part.startsWith("Editing a sent message"));
  return section?.match(/```typescript\n([\s\S]*?)```/)?.[1];
}

describe("README: Editing a sent message", () => {
  it("shows the sample this file compiles", async () => {
    const readme = await readFile(join(__dirname, "..", "..", "README.md"), "utf8");
    const source = await readFile(__filename, "utf8");
    const region = source.slice(source.indexOf(START) + START.length, source.indexOf(END));

    expect(readmeSample(readme)).toBe(region);
  });

  it("sends the final text as a second message when an edit is refused", async () => {
    const adapter = new RefusingEditAdapter("telegram");
    const out: OutboundMessage = { channel: { id: "c", type: "dm" }, text: "final" };

    const result = await sendWithPreview(adapter, out, "thinking…");

    expect(result.ok).toBe(true);
    expect(adapter.sent.map((message) => message.text)).toEqual(["thinking…", "final"]);
  });

  it("sends the final text once on an adapter that cannot edit", async () => {
    const adapter = new MockAdapter("sms");
    const out: OutboundMessage = { channel: { id: "c", type: "dm" }, text: "final" };

    const result = await sendWithPreview(adapter, out, "thinking…");

    expect(result.ok).toBe(true);
    expect(adapter.sent.map((message) => message.text)).toEqual(["final"]);
  });
});
