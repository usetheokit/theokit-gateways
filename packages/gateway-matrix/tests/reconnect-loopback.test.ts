/**
 * Runner `reconnect` + the real `matrix-js-sdk` against a loopback homeserver (no fake client):
 * the homeserver is down at `start()`, comes up later, the adapter connects and a DM reaches the
 * handler; and a rejected token is reported once and never retried.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { GatewayRunner, type MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MatrixAdapter } from "../src/adapter.js";

const USER = "@bot:localhost";
const ROOM = "!dm:localhost";
function homeserver(opts: { rejectToken?: boolean }) {
  let syncs = 0;
  let whoamis = 0;
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one flat request router for a fake homeserver.
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    req.resume();
    if (url.includes("/account/whoami")) {
      whoamis += 1;
      if (opts.rejectToken) return json(401, { errcode: "M_UNKNOWN_TOKEN", error: "bad token" });
      return json(200, { user_id: USER });
    }
    if (url.includes("/_matrix/client/versions")) return json(200, { versions: ["v1.5"] });
    if (url.includes("/pushrules")) return json(200, { global: {} });
    if (url.includes("/filter")) return json(200, { filter_id: "1" });
    if (url.includes("/sync")) {
      syncs += 1;
      const rooms =
        syncs === 1
          ? {}
          : {
              join: {
                [ROOM]: {
                  timeline: {
                    events: [
                      {
                        type: "m.room.message",
                        event_id: "$e1",
                        sender: "@alice:localhost",
                        origin_server_ts: Date.now() + 1000,
                        content: { msgtype: "m.text", body: "hello bot" },
                      },
                    ],
                  },
                  state: {
                    events: [
                      {
                        type: "m.room.member",
                        state_key: "@alice:localhost",
                        sender: "@alice:localhost",
                        event_id: "$m1",
                        origin_server_ts: 1,
                        content: { membership: "join" },
                      },
                      {
                        type: "m.room.member",
                        state_key: USER,
                        sender: USER,
                        event_id: "$m2",
                        origin_server_ts: 1,
                        content: { membership: "join" },
                      },
                    ],
                  },
                },
              },
            };
      if (syncs > 2) return setTimeout(() => json(200, { next_batch: `s${syncs}` }), 500);
      return json(200, { next_batch: `s${syncs}`, rooms });
    }
    json(404, { errcode: "M_NOT_FOUND" });
  });
  return { server, whoamis: () => whoamis };
}

function listen(server: Server, port = 0): Promise<number> {
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );
}

async function freePort(): Promise<number> {
  const s = createServer();
  const port = await listen(s);
  await new Promise((r) => s.close(r));
  return port;
}

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections?.();
    s.close();
  }
  vi.restoreAllMocks();
});

describe("runner reconnect against a loopback homeserver", () => {
  it("connects once the homeserver comes up and delivers a DM", async () => {
    const logs: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((c) => {
      logs.push(String(c));
      return true;
    });
    const port = await freePort();
    const hs = homeserver({});
    servers.push(hs.server);
    const adapter = new MatrixAdapter({
      homeserverUrl: `http://127.0.0.1:${port}`,
      accessToken: "tok",
      userId: USER,
    });
    const got: MessageEvent[] = [];
    const runner = new GatewayRunner({
      adapters: [adapter],
      connectFailure: "isolate",
      reconnect: { initialDelayMs: 100, maxDelayMs: 400 },
      handler: async (e) => {
        got.push(e);
      },
    });
    const started = await runner.start();
    expect(started.failed).toHaveLength(1);
    await listen(hs.server, port);
    await vi.waitFor(() => expect(got.length).toBeGreaterThan(0), { timeout: 15_000 });
    expect(got[0]?.text).toBe("hello bot");
    await runner.stop();
    expect(logs.join("")).toContain("connected on attempt");
  }, 30_000);

  it("reports a rejected token once and does not retry", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const hs = homeserver({ rejectToken: true });
    servers.push(hs.server);
    const port = await listen(hs.server);
    const runner = new GatewayRunner({
      adapters: [
        new MatrixAdapter({
          homeserverUrl: `http://127.0.0.1:${port}`,
          accessToken: "bad",
          userId: USER,
        }),
      ],
      connectFailure: "isolate",
      reconnect: { initialDelayMs: 50 },
      handler: async () => {},
    });
    const started = await runner.start();
    expect(started.failed).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 600));
    expect(hs.whoamis()).toBe(1);
    await runner.stop();
  });
});
