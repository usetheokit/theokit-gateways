/**
 * LINE — live tests against the real Messaging API.
 *
 * This suite matters more than most, because this package is where the whole
 * live-testing effort started. `makeClient` handed back the v9
 * `MessagingApiClient` untouched while `adapter.ts` called it positionally, so
 * every outbound message reached LINE as `{replyToken: undefined}` and came back
 * 400 — with eight unit tests green, because the fake implemented the positional
 * signature the real client does not have.
 *
 * That fix was verified against the installed `.d.ts`, not against LINE. The
 * outbound test below is what closes that gap: it is the first thing here that
 * has actually asked LINE whether the payload shape is right.
 *
 * LINE is webhook-based — the platform dials in — so inbound needs a publicly
 * reachable HTTPS endpoint and skips without one. Outbound and auth run
 * anywhere.
 */

import { createHmac } from "node:crypto";
import { createServer } from "node:http";

import { messagingApi } from "@line/bot-sdk";
import { LineAdapter } from "@theokit/gateway-line";
import { expect, it } from "vitest";

import { required, runMarker } from "../../src/credentials.js";
import { describeLive, describeLiveInbound, publicUrl, waitFor } from "../../src/harness.js";
import { platformById } from "../../src/platforms.js";

const LINE = platformById("line");

/** The port the tunnel forwards to. Fixed, because the tunnel was started against it. */
const PORT = Number(process.env.INTEGRATION_PUBLIC_PORT ?? 3100);

function makeAdapter(overrides: Record<string, unknown> = {}): LineAdapter {
  return new LineAdapter({
    channelSecret: required("LINE_CHANNEL_SECRET"),
    channelAccessToken: required("LINE_CHANNEL_ACCESS_TOKEN"),
    ...overrides,
  });
}

/** One delivery as it arrived: the header LINE signed with, and the exact bytes it signed. */
interface Delivery {
  signature: string | undefined;
  raw: string;
}

/**
 * A server that records what LINE posts and answers 200.
 *
 * `node:http` and not express: one endpoint that captures bytes needs no framework, and the
 * integration package does not carry express. The RAW body is the point — LINE signs the bytes, and
 * re-serialising parsed JSON would hash something else, so the signature check below would compare
 * a digest of the wrong input and fail for a correct delivery.
 */
function captureServer(into: Delivery[]): ReturnType<typeof createServer> {
  return createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const isDelivery = req.method === "POST" && (req.url ?? "").startsWith("/line");
      if (!isDelivery) {
        res.writeHead(404).end();
        return;
      }
      const header = req.headers["x-line-signature"];
      into.push({
        signature: typeof header === "string" ? header : undefined,
        raw: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(200).end();
    });
  });
}

describeLive(
  LINE,
  "authentication",
  () => {
    it("connects with a real channel access token", async () => {
      const adapter = makeAdapter();
      try {
        expect(await adapter.connect()).toBe(true);
      } finally {
        await adapter.disconnect();
      }
    }, 45_000);

    it("returns false rather than throwing on a token LINE rejects", async () => {
      // Building a LINE client performs no network I/O, so connect() reported
      // success for any string until 2026-08-17 and the failure only appeared at
      // the first send — as a 401 that reads like a send bug. It now calls
      // /v2/bot/info, and this is the assertion that proves LINE agrees.
      const adapter = makeAdapter({ channelAccessToken: "definitely-not-a-real-token" });
      try {
        expect(await adapter.connect()).toBe(false);
      } finally {
        await adapter.disconnect();
      }
    }, 45_000);
  },
  { sends: false },
);

describeLive(LINE, "outbound", () => {
  it("delivers a push message to the test user", async () => {
    // THE test for this package. A positional call against the v9 client sends
    // `{to: undefined, messages: undefined}`, which LINE answers 400 — so this
    // passing is the first real evidence the v9 wrapper is correct, rather than
    // merely type-correct.
    const adapter = makeAdapter();
    const marker = runMarker();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("LINE_TEST_USER_ID"), type: "dm" },
        text: `${marker} outbound ok`,
      });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      expect(result.messageId).toBeDefined();
    } finally {
      await adapter.disconnect();
    }
  }, 45_000);

  it("splits past LINE's 5000-char cap into parts LINE accepts", async () => {
    // The splitter walks GRAPHEMES, because LINE counts characters in a way that
    // severs an emoji if you cut by code unit. Only the API can confirm each part
    // it produces is accepted.
    const adapter = makeAdapter();
    const marker = runMarker();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("LINE_TEST_USER_ID"), type: "dm" },
        text: `${marker} ${"paragraph. ".repeat(800)}`,
      });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
    } finally {
      await adapter.disconnect();
    }
  }, 90_000);

  it("maps an unknown recipient into a structured error", async () => {
    const adapter = makeAdapter();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: "U00000000000000000000000000000000", type: "dm" },
        text: "this user does not exist",
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBeDefined();
      expect(result.error?.message.length ?? 0).toBeGreaterThan(0);
    } finally {
      await adapter.disconnect();
    }
  }, 45_000);

  it("refuses empty text without calling the API", async () => {
    const adapter = makeAdapter();
    try {
      await adapter.connect();
      const result = await adapter.sendMessage({
        channel: { id: required("LINE_TEST_USER_ID"), type: "dm" },
        text: "",
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("empty_text");
    } finally {
      await adapter.disconnect();
    }
  }, 45_000);
});

describeLiveInbound(LINE, "inbound round trip", () => {
  it("receives a delivery LINE itself sends, signed with the real channel secret", async () => {
    // The placeholder this replaces asserted `true === true`, and its comment was right about why:
    // a locally-served request proves the fixture works and nothing about LINE. The way out is not
    // to fake the round trip but to make LINE perform it — `POST /v2/bot/channel/webhook/test` asks
    // the platform to dial our endpoint for real, so what arrives is LINE's own request, signed with
    // LINE's own key. No second account and no human writing to the bot.
    const base = publicUrl();
    if (base === undefined) throw new Error("INTEGRATION_PUBLIC_URL is required by this suite");

    const received: Delivery[] = [];
    const server = captureServer(received);
    await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", () => resolve()));

    const client = new messagingApi.MessagingApiClient({
      channelAccessToken: required("LINE_CHANNEL_ACCESS_TOKEN"),
    });
    const endpoint = `${base}/line`;
    const previous = await client.getWebhookEndpoint().catch(() => undefined);

    try {
      await client.setWebhookEndpoint({ endpoint });
      const result = await client.testWebhookEndpoint({ endpoint });

      // LINE reports what IT saw. A 200 here means our endpoint answered LINE, not ourselves.
      expect(result.success, `LINE could not reach ${endpoint}: ${result.reason ?? "?"}`).toBe(
        true,
      );
      expect(result.statusCode).toBe(200);

      const delivery = await waitFor(() => received[0], {
        timeoutMs: 30_000,
        label: "a webhook delivery from LINE",
      });

      // The signature is the half that proves it came from LINE and not from anything on this
      // machine: only the holder of the channel secret can produce it over these exact bytes.
      const expected = createHmac("sha256", required("LINE_CHANNEL_SECRET"))
        .update(delivery.raw)
        .digest("base64");
      expect(delivery.signature, "LINE sent no signature").toBeDefined();
      expect(delivery.signature, "the delivery was not signed by LINE's channel secret").toBe(
        expected,
      );
    } finally {
      // Put the console back the way it was, whatever happened: leaving a tunnel URL registered
      // there would silently break inbound the moment this tunnel dies.
      if (previous?.endpoint !== undefined && previous.endpoint !== "") {
        await client.setWebhookEndpoint({ endpoint: previous.endpoint }).catch(() => {});
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 90_000);
});
