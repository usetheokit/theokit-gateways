import { GatewayConfigurationError, type MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleChatAdapter } from "../src/index.js";
import {
  APP_PRIVATE_KEY_PEM,
  AUDIENCE,
  idToken,
  messageEvent,
  NOW_MS,
  SERVICE_ACCOUNT,
  scriptedGoogle,
} from "./fixtures.js";

const servers = vi.hoisted(() => ({ created: 0 }));

vi.mock("../src/webhook-server.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/webhook-server.js")>();
  return {
    ...real,
    createWebhookServer: (opts: Parameters<typeof real.createWebhookServer>[0]) => {
      servers.created += 1;
      return real.createWebhookServer(opts);
    },
  };
});

const base = {
  serviceAccountEmail: SERVICE_ACCOUNT,
  privateKey: APP_PRIVATE_KEY_PEM,
  audience: AUDIENCE,
  now: () => NOW_MS,
};

afterEach(() => {
  servers.created = 0;
});

describe("webhook: external", () => {
  it("connects without a listener and dispatches handleRequest", async () => {
    const adapter = new GoogleChatAdapter({
      ...base,
      webhook: "external",
      fetch: scriptedGoogle().fetch,
    });
    const events: MessageEvent[] = [];
    adapter.onInbound(async (event) => {
      events.push(event);
    });

    expect(await adapter.connect()).toBe(true);
    expect(servers.created).toBe(0);

    const answer = await adapter.handleRequest(
      `Bearer ${idToken()}`,
      JSON.stringify(messageEvent()),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(answer).toEqual({ status: 200, body: {} });
    expect(events.map((e) => e.text)).toEqual(["hello there"]);

    await adapter.disconnect();
  });

  it.each([
    ["port", { port: 4000 }],
    ["app", { app: {} as never }],
  ])("refuses %s together with external", (name, extra) => {
    let thrown: unknown;
    try {
      new GoogleChatAdapter({ ...base, webhook: "external", ...extra });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayConfigurationError);
    expect((thrown as GatewayConfigurationError).code).toBe("conflicting_webhook_options");
    expect((thrown as Error).message).toContain(name);
  });
});
