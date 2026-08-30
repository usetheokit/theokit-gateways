/**
 * Lazy `matrix-js-sdk` loader.
 */

import { SDKNotInstalledError } from "./errors.js";
import type { MatrixClientLike } from "./sync.js";
import type { MatrixRoomLike } from "./types.js";

export interface MatrixSdkClient extends MatrixClientLike {
  startClient(opts: { initialSyncLimit: number }): Promise<void>;
  stopClient(): void;
  sendTextMessage(roomId: string, text: string): Promise<{ event_id: string }>;
  /**
   * Send a message whose content object the caller composes.
   *
   * `sendTextMessage` is a convenience that hard-codes `msgtype: m.text` and a bare `body`, so
   * it has nowhere to put `formatted_body` — the field Matrix documents for markup. Honouring
   * `OutboundMessage.format` therefore needs the general call, not a new argument on the
   * convenience one.
   */
  sendMessage?(roomId: string, content: Record<string, unknown>): Promise<{ event_id: string }>;
  getRoomIdForAlias(alias: string): Promise<{ room_id: string }>;
  getRoom(roomId: string): MatrixRoomLike | null;
  isRoomEncrypted?(roomId: string): boolean;
  /** Best-effort current user id; matrix-js-sdk returns `string | null`. */
  getUserId(): string | null;
  /**
   * `/_matrix/client/v3/account/whoami` — the cheapest call that makes the
   * server judge the access token. `startClient` does not: it begins syncing
   * asynchronously and resolves regardless, so without this an invalid token
   * produces a connected-looking adapter that never receives anything.
   */
  whoami(): Promise<{ user_id: string }>;
}

interface MatrixSdkModule {
  createClient(opts: { baseUrl: string; accessToken: string; userId: string }): MatrixSdkClient;
}

export async function loadMatrixSdk(): Promise<MatrixSdkModule> {
  try {
    const mod = await import("matrix-js-sdk");
    return mod as unknown as MatrixSdkModule;
  } catch {
    throw new SDKNotInstalledError();
  }
}
