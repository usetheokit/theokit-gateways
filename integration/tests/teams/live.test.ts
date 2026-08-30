/**
 * Microsoft Teams — live tests against the real Bot Framework.
 *
 * NEVER EXECUTED. No Teams credentials exist for this project, so every test
 * here skips naming the variable it wants. That is the point of the file: three
 * platforms sat in the registry with no suite at all, which made them invisible
 * rather than uncovered, and the readiness check that was supposed to catch it
 * only looked in one direction.
 *
 * Read this as a declared gap, not as coverage. When someone provisions an Azure
 * bot registration these assertions run for the first time, and first runs of
 * unexecuted tests find their own bugs — the email round trip in this suite took
 * three attempts once it finally executed.
 *
 * Teams is webhook-based: the platform posts to a URL it must reach, so inbound
 * needs a public HTTPS endpoint and is out of scope here for the same reason as
 * LINE.
 */

import { TeamsAdapter } from "@theokit/gateway-teams";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLive } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const TEAMS = platformById("teams");

function makeAdapter(overrides: Record<string, unknown> = {}): TeamsAdapter {
  return new TeamsAdapter({
    clientId: required("TEAMS_CLIENT_ID"),
    clientSecret: required("TEAMS_CLIENT_SECRET"),
    tenantId: required("TEAMS_TENANT_ID"),
    ...overrides,
  });
}

describeLive(
  TEAMS,
  "authentication",
  () => {
    it("connects with a real app registration", async () => {
      const adapter = makeAdapter();
      try {
        expect(await adapter.connect()).toBe(true);
      } finally {
        await adapter.disconnect();
      }
    }, 45_000);

    it("returns false rather than throwing on a secret Azure rejects", async () => {
      // Every sibling adapter answers false here. Matrix and LINE did not until
      // a real server was asked, so this assertion is worth making explicitly
      // rather than assuming the family behaves alike.
      const adapter = makeAdapter({ clientSecret: "definitely-not-a-real-secret" });
      try {
        expect(await adapter.connect()).toBe(false);
      } finally {
        await adapter.disconnect();
      }
    }, 45_000);
  },
  { sends: false },
);

describeLive(TEAMS, "outbound", () => {
  it("delivers a message to the test conversation", async () => {
    const adapter = makeAdapter();
    const marker = runMarker();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("TEAMS_TEST_CONVERSATION_ID"), type: "group" },
        text: `${marker} outbound ok`,
      });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
    } finally {
      await adapter.disconnect();
    }
  }, 45_000);

  it("refuses empty text without calling the API", async () => {
    const adapter = makeAdapter();
    const result = await adapter.sendMessage({
      channel: { id: required("TEAMS_TEST_CONVERSATION_ID"), type: "group" },
      text: "",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("empty_text");
  }, 30_000);
});
