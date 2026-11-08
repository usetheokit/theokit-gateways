import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { expect, it } from "vitest";

import { MattermostAdapter } from "../src/adapter.js";

// Deliberately no SDK mock: Node must load the real CommonJS getter exports.
// The peer-major matrix also runs this test with @mattermost/client 9.x.
it("connects, sends and edits with the real Mattermost client", async () => {
  const requests: { method: string | undefined; url: string | undefined; body: string }[] = [];
  const sockets = new Set<Socket>();
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, body });
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        req.url === "/api/v4/users/me" ? { id: "bot-1", username: "bot" } : { id: "p1" },
      ),
    );
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const authenticated = new Promise<void>((resolve) => {
    server.on("upgrade", (req, socket) => {
      const accept = createHash("sha1")
        .update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      socket.once("data", () => resolve());
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing server port");
  const adapter = new MattermostAdapter({
    baseUrl: `http://127.0.0.1:${address.port}`,
    accessToken: "test-token",
  });
  try {
    expect(await adapter.connect()).toBe(true);
    await authenticated;
    const channel = { id: "ch-1", type: "group" } as const;
    expect(await adapter.sendMessage({ text: "hello", channel })).toEqual({
      ok: true,
      messageId: "p1",
    });
    expect(await adapter.editMessage("p1", { text: "hi", channel })).toEqual({
      ok: true,
      messageId: "p1",
    });
    expect(requests).toEqual([
      { method: "GET", url: "/api/v4/users/me", body: "" },
      {
        method: "POST",
        url: "/api/v4/posts",
        body: JSON.stringify({ channel_id: "ch-1", message: "hello" }),
      },
      {
        method: "PUT",
        url: "/api/v4/posts/p1/patch",
        body: JSON.stringify({ id: "p1", message: "hi" }),
      },
    ]);
  } finally {
    await adapter.disconnect();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});
