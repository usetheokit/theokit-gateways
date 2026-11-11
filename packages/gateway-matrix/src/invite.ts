/**
 * Auto-join for room invites.
 *
 * Matrix delivers an invite as the bot's own `m.room.member` event with `membership: invite`.
 * `matrix-js-sdk` surfaces it as `RoomMember.membership` (live) and leaves invited rooms in
 * `getRooms()` with `getMyMembership() === "invite"` (the ones pending at start). Both paths end
 * in {@link handleInvite}, which asks the host's `acceptInvite` and joins only on `true`.
 */

export interface InviteMemberLike {
  readonly userId: string;
  readonly roomId: string;
  readonly membership?: string;
}

export interface InviteEventLike {
  getSender(): string | undefined;
}

export interface InviteRoomLike {
  readonly roomId: string;
  getMyMembership?(): string;
  /** The inviter is the sender of the bot's own member event. */
  getMember?(userId: string): { events?: { member?: InviteEventLike } } | null;
}

/** The slice of the SDK client the invite path uses. */
export interface InviteClientLike {
  on(event: string, listener: (...args: never[]) => void): void;
  off(event: string, listener: (...args: never[]) => void): void;
  joinRoom(roomId: string): Promise<unknown>;
  getRooms?(): InviteRoomLike[];
}

export interface InviteOpts {
  readonly botUserId: string;
  readonly acceptInvite: (inviter: string, roomId: string) => boolean | Promise<boolean>;
}

function warn(msg: string): void {
  process.stderr.write(`[gateway-matrix] ${msg}\n`);
}

/** Join `roomId` when the host accepts `inviter`; a refusal or a failure leaves the invite pending. */
export async function handleInvite(
  client: InviteClientLike,
  opts: InviteOpts,
  inviter: string,
  roomId: string,
  seen: Set<string>,
): Promise<void> {
  if (seen.has(roomId)) return;
  seen.add(roomId);
  try {
    if (!(await opts.acceptInvite(inviter, roomId))) return;
    await client.joinRoom(roomId);
  } catch (err) {
    // Forget it so a later sync can retry.
    seen.delete(roomId);
    warn(`join of ${roomId} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Watch for invites to the bot: live ones and those already pending. Returns the detach function.
 */
export function subscribeToInvites(client: InviteClientLike, opts: InviteOpts): () => void {
  const seen = new Set<string>();
  const run = (inviter: string, roomId: string): void => {
    void handleInvite(client, opts, inviter, roomId, seen).catch((err: unknown) => {
      warn(`invite handling failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  };
  const onMember = (event: InviteEventLike, member: InviteMemberLike): void => {
    if (member.userId !== opts.botUserId || member.membership !== "invite") return;
    run(event.getSender() ?? "", member.roomId);
  };
  const scanPending = (): void => {
    for (const room of client.getRooms?.() ?? []) {
      if (room.getMyMembership?.() !== "invite") continue;
      const inviter = room.getMember?.(opts.botUserId)?.events?.member?.getSender() ?? "";
      run(inviter, room.roomId);
    }
  };
  // `sync` fires on every sync state change, so invites pending at start are caught once the
  // first sync has produced the room list.
  client.on("RoomMember.membership", onMember as never);
  client.on("sync", scanPending as never);
  scanPending();
  return () => {
    client.off("RoomMember.membership", onMember as never);
    client.off("sync", scanPending as never);
  };
}
