/**
 * The gateway END TO END — the only suite here that deserves the name.
 *
 * Every other suite in this package is an integration test: one adapter against
 * one real API, proving the platform still serves the contract we coded against.
 * None of them imports `@theokit/gateway`, so until this file existed the core
 * had no live coverage at all (issue #20) — `GatewayRunner`, the hook chain and
 * `ctx.reply()` were proven only against fakes.
 *
 * This drives the flow a CONSUMER actually builds:
 *
 *   a real person sends a message
 *     -> the platform delivers it
 *     -> the adapter normalises it
 *     -> GatewayRunner runs the hook chain
 *     -> the handler replies through ctx.reply()
 *     -> the reply lands back on the platform
 *
 * Matrix is the host because it needs no credential from anyone: `pnpm
 * matrix:up` boots Continuwuity in Docker with a bot, a probe account and a
 * room. So this suite runs anywhere the other Docker-backed ones do, including
 * CI, and it costs nothing.
 *
 * The probe account is what makes it real. A bot cannot drive its own inbound —
 * every platform in this package drops messages it sent itself, which is the
 * lesson Telegram, Slack and Email each taught separately. The second identity
 * is not a convenience here; it is the only way the flow can be observed.
 */

import type { MessageEvent as GatewayMessageEvent } from "@theokit/gateway";
import {
  DeliveryRouter,
  type GatewayContext,
  type GatewayHook,
  GatewayLifecycleError,
  GatewayRunner,
  type PostOutboundContext,
} from "@theokit/gateway";
import { MatrixAdapter } from "@theokit/gateway-matrix";
import { expect, it } from "vitest";

import { required, runMarker } from "../src/credentials.js";
import { describeLive, waitFor } from "../src/harness.js";
import { platformById } from "../src/platforms.js";

const MATRIX = platformById("matrix");

function makeAdapter(): MatrixAdapter {
  return new MatrixAdapter({
    homeserverUrl: required("MATRIX_HOMESERVER_URL"),
    accessToken: required("MATRIX_ACCESS_TOKEN"),
    userId: required("MATRIX_USER_ID"),
    // The room already holds fixture traffic from bootstrap and from the
    // sibling suite. Without a narrow window the runner would answer all of it
    // on start, which is noise here and a loop in production.
    freshnessWindowMs: 60_000,
  });
}

/** Post as the probe — an identity that is NOT the bot. */
async function postAsProbe(roomId: string, body: string): Promise<void> {
  const token = required("MATRIX_TEST_SENDER_TOKEN");
  const url = `${required("MATRIX_HOMESERVER_URL")}/_matrix/client/v3/rooms/${encodeURIComponent(
    roomId,
  )}/send/m.room.message/${encodeURIComponent(`e2e-${Date.now()}-${Math.random()}`)}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ msgtype: "m.text", body }),
  });
  if (!res.ok) throw new Error(`probe post failed: ${res.status}`);
}

/** Read the room back as the probe, so the assertion sees what a USER sees. */
async function roomBodiesAsProbe(roomId: string): Promise<string[]> {
  const token = required("MATRIX_TEST_SENDER_TOKEN");
  const url = `${required("MATRIX_HOMESERVER_URL")}/_matrix/client/v3/rooms/${encodeURIComponent(
    roomId,
  )}/messages?dir=b&limit=40`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const body = (await res.json()) as { chunk?: Array<{ content?: { body?: string } }> };
  return (body.chunk ?? []).map((e) => e.content?.body ?? "");
}

describeLive(MATRIX, "gateway end to end", () => {
  it("answers a real message through the runner, and the reply lands in the room", async () => {
    // THE test issue #20 asked for. Everything below the handler is real: a real
    // homeserver, a real second account, the real adapter, and the real runner.
    const roomId = required("MATRIX_TEST_ROOM_ID");
    const marker = runMarker();
    const seenByHook: string[] = [];

    const auditHook: GatewayHook = {
      name: "audit",
      async pre_inbound({ event }) {
        seenByHook.push(event.text);
        return { block: false };
      },
    };

    const runner = new GatewayRunner({
      adapters: [makeAdapter()],
      hooks: [auditHook],
      handler: async (event: GatewayMessageEvent, ctx: GatewayContext) => {
        if (!event.text.includes(marker)) return;
        await ctx.reply(`${marker} answered`);
      },
    });

    try {
      await runner.start();
      await postAsProbe(roomId, `${marker} ping`);

      // The hook saw it: proves the chain ran, not merely that a message arrived.
      await waitFor(() => seenByHook.find((t) => t.includes(marker)), {
        timeoutMs: 60_000,
        intervalMs: 1_000,
        label: `the hook chain to observe ${marker}`,
      });

      // The reply is in the room, read back as the PROBE rather than trusted
      // from ctx.reply()'s return value. A send that reports success and does
      // not arrive is exactly the LINE defect this package was built to catch.
      await waitFor(
        async () => (await roomBodiesAsProbe(roomId)).find((b) => b === `${marker} answered`),
        { timeoutMs: 60_000, intervalMs: 2_000, label: `the reply to ${marker} in the room` },
      );
    } finally {
      await runner.stop();
    }
  }, 180_000);

  it("lets a blocking hook stop the handler, and says so in the room", async () => {
    // The hook chain's whole purpose: refuse a message before the handler runs.
    // Unit tests prove the decision; only this proves the refusal reaches the
    // person who wrote in, over a real transport.
    const roomId = required("MATRIX_TEST_ROOM_ID");
    const marker = runMarker();
    let handlerRan = false;

    const denyHook: GatewayHook = {
      name: "deny",
      async pre_inbound({ event }) {
        if (!event.text.includes(marker)) return { block: false };
        return { block: true, message: `${marker} blocked by policy` };
      },
    };

    const runner = new GatewayRunner({
      adapters: [makeAdapter()],
      hooks: [denyHook],
      handler: async (event: GatewayMessageEvent) => {
        // Guarded by marker, and the guard is the test. Without it any traffic
        // in the room sets this flag — including the previous test's, seconds
        // earlier and well inside the freshness window — and the assertion then
        // reports a blocking-hook defect that is really a fixture leaking in.
        // The first draft had no guard and failed exactly that way.
        if (event.text.includes(marker)) handlerRan = true;
      },
    });

    try {
      await runner.start();
      await postAsProbe(roomId, `${marker} should be blocked`);

      await waitFor(
        async () =>
          (await roomBodiesAsProbe(roomId)).find((b) => b === `${marker} blocked by policy`),
        { timeoutMs: 60_000, intervalMs: 2_000, label: `the block notice for ${marker}` },
      );
      expect(handlerRan, "the handler ran despite a blocking hook").toBe(false);
    } finally {
      await runner.stop();
    }
  }, 180_000);

  it("keeps answering after a handler throws, instead of dying with it", async () => {
    // The capability the whole chain rests on: user code is allowed to be wrong.
    // A handler that throws must not take the runner, the connection or the
    // process with it, and the NEXT message must still be answered — which is
    // the half a "did not crash" assertion misses.
    //
    // Scope, stated because it is easy to overclaim: this proves the CORE path
    // (GatewayRunner's EC-F catch) over a real transport. The adapter-side half
    // of the same contract — two adapters that used to discard the rejection
    // and end the process (#41) — cannot be shown here, because Teams and
    // WhatsApp have no Docker host. That half is held by their package tests
    // and by the cross-adapter invariants in packages/gateway.
    const roomId = required("MATRIX_TEST_ROOM_ID");
    const marker = runMarker();

    const runner = new GatewayRunner({
      adapters: [makeAdapter()],
      handler: async (event: GatewayMessageEvent, ctx: GatewayContext) => {
        if (event.text === `${marker} boom`) throw new Error(`${marker} handler exploded`);
        if (event.text === `${marker} after`) await ctx.reply(`${marker} still alive`);
      },
    });

    try {
      await runner.start();
      await postAsProbe(roomId, `${marker} boom`);
      await postAsProbe(roomId, `${marker} after`);

      await waitFor(
        async () => (await roomBodiesAsProbe(roomId)).find((b) => b === `${marker} still alive`),
        { timeoutMs: 60_000, intervalMs: 2_000, label: `the reply after the throw, for ${marker}` },
      );
    } finally {
      await runner.stop();
    }
  }, 180_000);

  it("fires on_error with the handler's failure", async () => {
    // The third hook fire point. Until this ran, the live suite exercised one of
    // the three: a consumer wiring on_error to their error tracker had no
    // evidence it was ever reached over a real transport.
    const roomId = required("MATRIX_TEST_ROOM_ID");
    const marker = runMarker();
    const errors: string[] = [];

    const trackerHook: GatewayHook = {
      name: "tracker",
      async on_error({ event, error }) {
        if (event.text.includes(marker)) errors.push(error.message);
      },
    };

    const runner = new GatewayRunner({
      adapters: [makeAdapter()],
      hooks: [trackerHook],
      handler: async (event: GatewayMessageEvent) => {
        if (event.text.includes(marker)) throw new Error(`${marker} handler exploded`);
      },
    });

    try {
      await runner.start();
      await postAsProbe(roomId, `${marker} please fail`);

      const seen = await waitFor(() => errors.find((m) => m.includes(marker)), {
        timeoutMs: 60_000,
        intervalMs: 1_000,
        label: `on_error to observe ${marker}`,
      });
      expect(seen).toBe(`${marker} handler exploded`);
    } finally {
      await runner.stop();
    }
  }, 180_000);

  it("fires post_outbound with the result the platform actually returned", async () => {
    // This hook had no production caller at all until #38 — documented,
    // exported, typed, and never invoked. A unit test proves it is wired; only
    // this proves the `result` it carries is a real platform acknowledgement
    // rather than a shape the runner made up.
    const roomId = required("MATRIX_TEST_ROOM_ID");
    const marker = runMarker();
    const delivered: PostOutboundContext[] = [];

    const auditHook: GatewayHook = {
      name: "audit",
      async post_outbound(ctx) {
        if (ctx.outbound.text.includes(marker)) delivered.push(ctx);
      },
    };

    const runner = new GatewayRunner({
      adapters: [makeAdapter()],
      hooks: [auditHook],
      handler: async (event: GatewayMessageEvent, ctx: GatewayContext) => {
        if (event.text === `${marker} ping`) await ctx.reply(`${marker} pong`);
      },
    });

    try {
      await runner.start();
      await postAsProbe(roomId, `${marker} ping`);

      const seen = await waitFor(() => delivered[0], {
        timeoutMs: 60_000,
        intervalMs: 1_000,
        label: `post_outbound to observe the reply to ${marker}`,
      });
      expect(seen.event.text).toBe(`${marker} ping`);
      expect(seen.outbound.text).toBe(`${marker} pong`);
      expect(seen.result.ok, "the hook was handed a failed send").toBe(true);
      // A real Matrix event id, not a placeholder: this is the value that proves
      // the hook observed the platform's answer and not the runner's optimism.
      expect(seen.result.messageId ?? "").toMatch(/^\$/);
    } finally {
      await runner.stop();
    }
  }, 180_000);

  it("routes a slash command to its own handler, over a real transport", async () => {
    // `runner.command()` is the sugar most consumers reach for first, and it had
    // no live coverage: word-boundary matching (EC-A) was proven only against
    // synthesised events.
    const roomId = required("MATRIX_TEST_ROOM_ID");
    const marker = runMarker();
    let defaultHandlerRan = false;

    const runner = new GatewayRunner({
      adapters: [makeAdapter()],
      handler: async (event: GatewayMessageEvent) => {
        if (event.text.includes(marker)) defaultHandlerRan = true;
      },
    });
    runner.command("ping", async (event: GatewayMessageEvent, ctx: GatewayContext) => {
      if (event.text.includes(marker)) await ctx.reply(`${marker} pong from command`);
    });

    try {
      await runner.start();
      await postAsProbe(roomId, `/ping ${marker}`);

      await waitFor(
        async () =>
          (await roomBodiesAsProbe(roomId)).find((b) => b === `${marker} pong from command`),
        { timeoutMs: 60_000, intervalMs: 2_000, label: `the command reply for ${marker}` },
      );
      expect(defaultHandlerRan, "the default handler ran for a registered command").toBe(false);
    } finally {
      await runner.stop();
    }
  }, 180_000);

  it("drains a handler that is still running when stop() is called (EC-E)", async () => {
    // The drain is what separates a clean shutdown from a truncated one: a reply
    // half-written when SIGINT arrives either lands or does not, and which one
    // is a property of stop(), not of luck.
    const roomId = required("MATRIX_TEST_ROOM_ID");
    const marker = runMarker();
    let started = false;

    const runner = new GatewayRunner({
      adapters: [makeAdapter()],
      handler: async (event: GatewayMessageEvent, ctx: GatewayContext) => {
        if (event.text !== `${marker} slow`) return;
        started = true;
        await new Promise((r) => setTimeout(r, 3_000));
        await ctx.reply(`${marker} finished during drain`);
      },
    });

    await runner.start();
    await postAsProbe(roomId, `${marker} slow`);
    await waitFor(() => (started ? true : undefined), {
      timeoutMs: 60_000,
      intervalMs: 500,
      label: `the slow handler for ${marker} to start`,
    });

    // stop() while the handler is mid-flight. It must wait for it.
    await runner.stop();

    await waitFor(
      async () =>
        (await roomBodiesAsProbe(roomId)).find((b) => b === `${marker} finished during drain`),
      { timeoutMs: 30_000, intervalMs: 2_000, label: `the drained reply for ${marker}` },
    );
  }, 180_000);

  it("refuses to restart a stopped runner, against a real connection", async () => {
    // stop() is terminal (#39). Before, a second start() reconnected the adapter
    // and the next stop() did nothing — a live socket nothing could close. The
    // guard is unit-tested against a fake; this asserts it holds when the
    // adapter is a real client with a real session behind it.
    const runner = new GatewayRunner({
      adapters: [makeAdapter()],
      handler: async () => {},
    });
    await runner.start();
    await runner.stop();

    await expect(runner.start()).rejects.toBeInstanceOf(GatewayLifecycleError);
  }, 120_000);

  it("delivers through DeliveryRouter, the outbound half of the public API", async () => {
    // The router is exported for scheduled and fan-out sends — the path that
    // does NOT begin with an inbound event, so no other test here reaches it. It
    // had zero live coverage: of the core's ten runtime exports, only
    // GatewayRunner was driven by this package at all.
    const roomId = required("MATRIX_TEST_ROOM_ID");
    const marker = runMarker();
    const adapter = makeAdapter();
    const router = new DeliveryRouter();
    router.register(adapter);

    try {
      expect(await adapter.connect()).toBe(true);
      const result = await router.send({
        platform: "matrix",
        channel: { id: roomId, type: "group" },
        text: `${marker} via router`,
      });

      expect(result.ok, `router send failed: ${result.error?.code}`).toBe(true);
      await waitFor(
        async () => (await roomBodiesAsProbe(roomId)).find((b) => b === `${marker} via router`),
        { timeoutMs: 30_000, intervalMs: 2_000, label: `the router delivery for ${marker}` },
      );
    } finally {
      await adapter.disconnect();
    }
  }, 120_000);
});
