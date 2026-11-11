import { describe, expect, it, vi } from "vitest";

import { subscribeToInvites } from "../src/invite.js";

function fake(rooms: unknown[] = []) {
  const handlers = new Map<string, (...a: never[]) => void>();
  const joined: string[] = [];
  const client = {
    on: (e: string, l: (...a: never[]) => void) => void handlers.set(e, l),
    off: (e: string) => void handlers.delete(e),
    joinRoom: vi.fn(async (id: string) => void joined.push(id)),
    getRooms: () => rooms as never,
  };
  return { client, handlers, joined };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const BOT = "@bot:s";
const ev = (sender: string) => ({ getSender: () => sender });

describe("subscribeToInvites", () => {
  it("joins a live invite the host accepts, once", async () => {
    const f = fake();
    const accept = vi.fn(() => true);
    subscribeToInvites(f.client, { botUserId: BOT, acceptInvite: accept });
    const m = { userId: BOT, roomId: "!a:s", membership: "invite" };
    (f.handlers.get("RoomMember.membership") as (...a: unknown[]) => void)(ev("@h:s"), m);
    (f.handlers.get("RoomMember.membership") as (...a: unknown[]) => void)(ev("@h:s"), m);
    await flush();
    expect(accept).toHaveBeenCalledWith("@h:s", "!a:s");
    expect(f.joined).toEqual(["!a:s"]);
  });

  it("leaves an invite pending when the host refuses", async () => {
    const f = fake();
    subscribeToInvites(f.client, { botUserId: BOT, acceptInvite: () => false });
    (f.handlers.get("RoomMember.membership") as (...a: unknown[]) => void)(ev("@x:s"), {
      userId: BOT,
      roomId: "!a:s",
      membership: "invite",
    });
    await flush();
    expect(f.joined).toEqual([]);
  });

  it("ignores other users and other memberships", async () => {
    const f = fake();
    subscribeToInvites(f.client, { botUserId: BOT, acceptInvite: () => true });
    const h = f.handlers.get("RoomMember.membership") as (...a: unknown[]) => void;
    h(ev("@h:s"), { userId: "@other:s", roomId: "!a:s", membership: "invite" });
    h(ev("@h:s"), { userId: BOT, roomId: "!b:s", membership: "join" });
    await flush();
    expect(f.joined).toEqual([]);
  });

  it("joins invites pending at start", async () => {
    const room = {
      roomId: "!p:s",
      getMyMembership: () => "invite",
      getMember: () => ({ events: { member: ev("@h:s") } }),
    };
    const f = fake([room, { roomId: "!j:s", getMyMembership: () => "join" }]);
    const accept = vi.fn(() => true);
    subscribeToInvites(f.client, { botUserId: BOT, acceptInvite: accept });
    await flush();
    expect(accept).toHaveBeenCalledWith("@h:s", "!p:s");
    expect(f.joined).toEqual(["!p:s"]);
  });

  it("detaches its listeners", () => {
    const f = fake();
    const off = subscribeToInvites(f.client, { botUserId: BOT, acceptInvite: () => true });
    off();
    expect(f.handlers.size).toBe(0);
  });
});
