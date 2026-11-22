import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { TelegramAdapter } from "../src/adapter.js";

const TOKEN = "123:fake-token";
let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

async function fakeBotApi(): Promise<{ base: string; paths: string[] }> {
  const paths: string[] = [];
  server = createServer((req, res) => {
    paths.push(req.url ?? "");
    const method = (req.url ?? "").split("/").pop();
    const result =
      method === "getMe"
        ? { id: 1, is_bot: true, first_name: "b", username: "b_bot" }
        : { message_id: 9, date: 0, chat: { id: 1, type: "private" } };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, result }));
  });
  await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, paths };
}

describe("TelegramAdapter apiBase", () => {
  it("sends getMe and sendMessage to the configured root", async () => {
    const { base, paths } = await fakeBotApi();
    const adapter = new TelegramAdapter({ token: TOKEN, apiBase: `${base}/`, inbound: "webhook" });
    expect(await adapter.connect()).toBe(true);
    const r = await adapter.sendMessage({ channel: { id: "1" }, text: "hi" } as never);
    expect(r).toEqual({ ok: true, messageId: "9" });
    expect(paths).toEqual([`/bot${TOKEN}/getMe`, `/bot${TOKEN}/sendMessage`]);
  });

  it("leaves grammY's default root (https://api.telegram.org) without apiBase", () => {
    const api = (a: TelegramAdapter) =>
      a.getBot().api as unknown as { options?: { apiRoot?: string } };
    expect(api(new TelegramAdapter({ token: TOKEN })).options?.apiRoot).toBeUndefined();
    expect(
      api(new TelegramAdapter({ token: TOKEN, apiBase: "http://h:1/" })).options?.apiRoot,
    ).toBe("http://h:1");
  });
});
