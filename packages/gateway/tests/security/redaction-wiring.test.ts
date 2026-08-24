import { describe, expect, it, vi } from "vitest";

import { GatewayRunner } from "../../src/runner/gateway-runner.js";
import { MockAdapter } from "../adapter/mock-adapter.js";

// The wiring, not the patterns.
//
// `credential-patterns.test.ts` proves the shapes are redacted once registration has run. This
// proves registration actually runs on the path that logs — the pillar (a) caller, without which
// the module is a table nobody reads. It drives the runner through `start()` and an adapter emit,
// the same path a real gateway takes, rather than reaching for the private dispatch.
//
// The token is synthetic and built to Telegram's documented `<bot_id>:<secret>` format. The
// assertion is about the SECRET half specifically: before B-012 the SDK's `key=value` matcher
// redacted the public bot id and left this half intact, so an assertion about the whole token
// would have passed while the secret reached the log.

// Assembled at runtime — see the note in credential-patterns.test.ts.
const SYNTHETIC_TOKEN = ["8123456789", "AAF-zZbQm3kL9xTuVw1yRs4pQd7NhGjKlMn"].join(":");
const SECRET_HALF = SYNTHETIC_TOKEN.split(":")[1]!;

describe("the runner redacts a credential that reaches a handler error", () => {
  it("does not write the secret half of a telegram token to stderr", async () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });

    const adapter = new MockAdapter("telegram");
    const runner = new GatewayRunner({
      adapters: [adapter],
      handler: () => {
        throw new Error(`upstream rejected token=${SYNTHETIC_TOKEN}`);
      },
    });

    try {
      await runner.start();
      await adapter.emit({
        id: "tg-1",
        platform: "telegram",
        sender: { id: "100" },
        channel: { id: "1", type: "dm" },
        text: "hi",
        receivedAt: 0,
        telegram: { chatId: 1, messageId: 1, raw: {} },
      });
      await runner.stop();
    } finally {
      spy.mockRestore();
    }

    const stderr = written.join("");
    expect(stderr, "the handler error never reached stderr — the test proves nothing").toContain(
      "handler error",
    );
    expect(stderr, "the secret half of the token was written to the log").not.toContain(
      SECRET_HALF,
    );
  });
});

describe("the hook executor redacts too", () => {
  it("does not write the secret half of a telegram token when a pre_inbound hook throws", async () => {
    // The second of the two log sites. Without this, reverting `hooks/executor.ts` to the SDK's
    // bare `Security.redact` left the whole suite green — pillar (a) unproven for that site, which
    // a review measured by doing exactly that.
    const { HookExecutor } = await import("../../src/hooks/executor.js");
    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });

    try {
      const executor = new HookExecutor([
        {
          name: "boom",
          pre_inbound: () => {
            throw new Error(`upstream rejected token=${SYNTHETIC_TOKEN}`);
          },
        } as never,
      ]);
      await executor.firePreInbound({
        event: {
          id: "tg-1",
          platform: "telegram",
          sender: { id: "100" },
          channel: { id: "1", type: "dm" },
          text: "hi",
          receivedAt: 0,
          telegram: { chatId: 1, messageId: 1, raw: {} },
        },
      } as never);
    } finally {
      spy.mockRestore();
    }

    const stderr = written.join("");
    expect(stderr, "the hook throw never reached stderr — the test proves nothing").toContain(
      "threw",
    );
    expect(stderr, "the secret half reached the log from the hook path").not.toContain(SECRET_HALF);
  });
});
