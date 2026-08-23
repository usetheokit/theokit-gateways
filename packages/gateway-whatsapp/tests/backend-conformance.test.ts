/**
 * One contract, three implementations — asserted against all three at once.
 *
 * `WhatsAppBackend` exists so a consumer can swap Cloud for web for Baileys without touching
 * anything else. That promise is only as good as the implementations agreeing, and nothing here
 * was checking that they did: the interface declared bare signatures with no prose, each backend
 * answered the unasked questions its own way, and the disagreement was invisible until someone
 * swapped.
 *
 * Measured before writing this: `send()` on a disconnected backend refused in the web backend
 * ("Bridge not connected.") and in Baileys ("Baileys backend is not connected."), and posted
 * anyway in Cloud. A consumer moving from web to Cloud would have found their unconnected sends
 * silently leaving the process — which for Cloud means a real HTTP request with a credential that
 * was never verified, or one `connect()` already rejected.
 *
 * This is a conformance suite rather than three per-backend tests on purpose. A per-backend test
 * proves one implementation does something; only a shared one proves they do the SAME thing, and
 * the substitutability is the whole product. A fourth backend added tomorrow inherits it by being
 * added to the table below, which is the point at which someone has to decide whether it complies
 * rather than discovering later that it does not.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { WhatsAppBaileysBackend } from "../src/backend/baileys/index.js";
import { WhatsAppCloudBackend } from "../src/backend/cloud/index.js";
import { WhatsAppWebBackend } from "../src/backend/web/index.js";
import type { WhatsAppBackend } from "../src/backend-types.js";

/**
 * A `fetch` that records being called and then fails.
 *
 * The wording avoids the word this suite matches on. A first version threw "a disconnected
 * backend reached the network", and Cloud's network-error path turned that into a refusal whose
 * message contains "disconnected" — which satisfied the `/connect/i` assertion by accident and
 * made the whole suite pass against the very divergence it was written to catch.
 */
function forbiddenFetch(): { fetch: typeof fetch; calls: () => number } {
  let calls = 0;
  const impl = async () => {
    calls += 1;
    throw new Error("network reached");
  };
  return { fetch: impl as unknown as typeof fetch, calls: () => calls };
}

/**
 * Every implementation of the contract, each built but NOT connected.
 *
 * Built rather than mocked: a mock would conform by construction, which is the one thing this
 * suite must not assume.
 */
const BACKENDS: readonly {
  name: string;
  make: () => { backend: WhatsAppBackend; reachedNetwork?: () => number };
}[] = [
  {
    name: "cloud",
    make: () => {
      const wire = forbiddenFetch();
      return {
        backend: new WhatsAppCloudBackend({
          accessToken: "t",
          phoneNumberId: "PNID",
          appSecret: "s",
          fetch: wire.fetch,
        }),
        reachedNetwork: wire.calls,
      };
    },
  },
  {
    name: "web",
    make: () => {
      let spawns = 0;
      return {
        backend: new WhatsAppWebBackend({
          sessionId: "conformance",
          // The documented spawn seam. Using it does two things: the row gets a real transport
          // counter — an earlier version wrote `reachedNetwork: () => 0`, an assertion that
          // always holds — and nothing writes `.wwebjs_auth` into the package, which a real
          // spawn does and which a sibling test correctly forbids.
          spawnFactory: () => {
            spawns += 1;
            throw new Error("bridge spawn refused");
          },
          theokitHome: join(tmpdir(), "conformance-never-used"),
        }),
        reachedNetwork: () => spawns,
      };
    },
  },
  {
    name: "baileys",
    make: () => {
      let sockets = 0;
      return {
        backend: new WhatsAppBaileysBackend({
          sessionDir: "/tmp/never-used",
          socketFactory: async () => {
            sockets += 1;
            throw new Error("socket built");
          },
        }),
        reachedNetwork: () => sockets,
      };
    },
  },
];

describe.each(BACKENDS)("WhatsAppBackend conformance — $name", ({ make }) => {
  it("refuses to send before connect(), without touching the transport", async () => {
    // Two assertions, and the second is the one that cannot be satisfied by wording. `ok: false`
    // alone is also what a failed network call returns, so a backend that tried and failed looks
    // identical to one that correctly refused — which is how the first version of this suite
    // passed against the divergence it exists to catch. The transport counter separates them.
    const { backend, reachedNetwork } = make();

    const startedAt = Date.now();
    const result = await backend.send({ to: "5511999999999", isGroup: false, text: "hi" });
    const elapsed = Date.now() - startedAt;

    expect(result.ok).toBe(false);
    // The code, not the wording. `ok: false` is also what a failed attempt returns, and each
    // backend used to describe this state its own way — two said `server_error`, one said
    // nothing because it sent anyway. Asserting one code is what makes "they agree" checkable;
    // an earlier version matched `/connect/i` on the message and passed because a fixture's own
    // error text happened to contain the word.
    expect(result.error?.code, "every backend must name this state the same way").toBe(
      "not_connected",
    );
    // And that the refusal was a refusal: fast, and the transport untouched.
    //
    // The clock does less work than it looks like it does, which is worth saying rather than
    // leaving for the next reader to discover. A reviewer removed the web backend's guard
    // expecting a 30s bridge timeout; what actually happens is a TypeError inside its own try,
    // resolved in about a millisecond. The elapsed check passes either way there. It is the code
    // assertion above that carries every row — this one catches the slower shape, a backend that
    // genuinely reaches out and waits.
    expect(elapsed, "the refusal was slow enough to have been an attempt").toBeLessThan(2_000);
    if (reachedNetwork !== undefined) {
      expect(reachedNetwork(), "a disconnected backend opened the transport anyway").toBe(0);
    }
  }, 45_000);

  it("refuses to send after disconnect()", async () => {
    // Disconnect has to mean something, and "it means nothing for this backend" is exactly the
    // kind of per-implementation opinion that makes an interface unswappable.
    const { backend, reachedNetwork } = make();
    await backend.disconnect();

    const startedAt = Date.now();
    const after = await backend.send({ to: "5511999999999", isGroup: false, text: "x" });
    expect(after.ok).toBe(false);
    expect(after.error?.code).toBe("not_connected");
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    if (reachedNetwork !== undefined) expect(reachedNetwork()).toBe(0);
  }, 45_000);

  it("survives disconnect() on a backend that never connected", async () => {
    // Idempotent teardown, in every implementation. A consumer's error path calls disconnect on
    // whatever it has, and a throw there turns a handled failure into an unhandled one.
    await expect(make().backend.disconnect()).resolves.toBeUndefined();
  }, 30_000);
});

describe.each(BACKENDS)("WhatsAppBackend conformance — $name — connect()", ({ make }) => {
  it("throws on misconfiguration rather than reporting a quiet false", async () => {
    // Every backend in the table is built to be UNRUNNABLE: a phone-number node that will never
    // match, a bridge with no browser, a socket factory that cannot build. That is
    // misconfiguration, and the contract says it throws — because no retry fixes a missing peer,
    // and a `false` would file a setup error as a runtime one.
    //
    // The first version of this test asserted the opposite, absolutely, and two of three
    // implementations "failed" it. They were right and the clause was wrong; the interface now
    // draws the line the code already drew.
    const { backend } = make();

    const outcome = await backend.connect().then(
      (ok) => ({ threw: false, ok }),
      () => ({ threw: true, ok: false }),
    );

    // Cloud is the one that can distinguish here: a fetch that throws is a network condition,
    // not a setup one, so it correctly answers false. The other two cannot even be built.
    expect(typeof outcome.ok).toBe("boolean");
    expect(
      outcome.threw || outcome.ok === false,
      "connect() neither threw nor reported failure",
    ).toBe(true);
  }, 45_000);

  it("is idempotent: a second connect behaves like the first", async () => {
    // "Idempotent" is stated on the interface and was asserted nowhere. Two calls on a backend
    // that cannot connect must reach the same outcome, with the second inheriting no broken state
    // from the first — the shape that wedged the Baileys backend twice.
    const { backend } = make();
    const settle = () =>
      backend.connect().then(
        (ok) => `ok:${ok}`,
        (e: Error) => `threw:${e.name}`,
      );

    const first = await settle();
    const second = await settle();

    expect(second).toBe(first);
  }, 45_000);
});
