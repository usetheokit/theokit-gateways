/**
 * The default `LarkTransport`, over `@larksuiteoapi/node-sdk`'s `Client` and long-connection
 * `WSClient`. The SDK is an optional peer, loaded on first use.
 */

import { loadPeer } from "@theokit/gateway";

import type { LarkApiResult, LarkConnectionHandlers, LarkTransport } from "./types.js";

const MESSAGE_EVENT = "im.message.receive_v1";

interface SdkApiAnswer {
  readonly code?: number;
  readonly msg?: string;
  readonly data?: { readonly message_id?: string };
}

/** The part of `@larksuiteoapi/node-sdk` this transport uses. */
export interface LarkSdk {
  readonly Domain: { readonly Feishu: number; readonly Lark: number };
  readonly Client: new (params: {
    appId: string;
    appSecret: string;
    domain: number;
  }) => {
    readonly auth: {
      readonly tenantAccessToken: {
        internal(payload: { data: { app_id: string; app_secret: string } }): Promise<SdkApiAnswer>;
      };
    };
    readonly im: {
      readonly message: {
        create(payload: {
          params: { receive_id_type: "chat_id" };
          data: { receive_id: string; msg_type: "text"; content: string };
        }): Promise<SdkApiAnswer>;
        reply(payload: {
          path: { message_id: string };
          data: { msg_type: "text"; content: string };
        }): Promise<SdkApiAnswer>;
      };
    };
  };
  readonly WSClient: new (params: {
    appId: string;
    appSecret: string;
    domain: number;
    onReady?: () => void;
    onError?: (err: Error) => void;
  }) => {
    start(params: { eventDispatcher: unknown }): Promise<void>;
    close(): void;
  };
  readonly EventDispatcher: new (
    params: Record<string, never>,
  ) => {
    register(handles: Record<string, (data: unknown) => Promise<void>>): unknown;
  };
}

/** Options the default transport needs. */
export interface LarkTransportOptions {
  readonly appId: string;
  readonly appSecret: string;
  readonly domain?: "feishu" | "lark";
}

const loadSdk = (): Promise<LarkSdk> =>
  loadPeer<LarkSdk>(
    () => import("@larksuiteoapi/node-sdk"),
    () => {
      throw new Error(
        "@theokit/gateway-feishu-lark needs @larksuiteoapi/node-sdk: pnpm add @larksuiteoapi/node-sdk",
      );
    },
  );

/**
 * Build the transport over the SDK. `load` is the test seam: it returns the SDK module.
 *
 * The long connection keeps the SDK's own reconnect (`autoReconnect` left at its default): the SDK
 * retries on the interval Feishu's servers send, and the adapter runs no loop of its own (plan D7).
 */
export function createLarkTransport(
  options: LarkTransportOptions,
  load: () => Promise<LarkSdk> = loadSdk,
): LarkTransport {
  let sdk: Promise<LarkSdk> | undefined;
  let client: InstanceType<LarkSdk["Client"]> | undefined;
  let socket: InstanceType<LarkSdk["WSClient"]> | undefined;
  const loaded = (): Promise<LarkSdk> => {
    sdk ??= load();
    return sdk;
  };
  const credentials = async () => {
    const mod = await loaded();
    const domain = options.domain === "lark" ? mod.Domain.Lark : mod.Domain.Feishu;
    return { mod, params: { appId: options.appId, appSecret: options.appSecret, domain } };
  };
  const api = async () => {
    if (client === undefined) {
      const { mod, params } = await credentials();
      client = new mod.Client(params);
    }
    return client;
  };
  return {
    async tenantToken() {
      const answer = await (await api()).auth.tenantAccessToken.internal({
        data: { app_id: options.appId, app_secret: options.appSecret },
      });
      return toResult(answer);
    },
    async start(handlers: LarkConnectionHandlers) {
      const { mod, params } = await credentials();
      const dispatcher = new mod.EventDispatcher({});
      dispatcher.register({
        [MESSAGE_EVENT]: async (data) => {
          handlers.onMessage(data);
        },
      });
      // `start()` resolves before the socket is up; `onReady` and `onError` say how it went.
      await new Promise<void>((resolve, reject) => {
        let ready = false;
        socket = new mod.WSClient({
          ...params,
          onReady: () => {
            ready = true;
            resolve();
          },
          onError: (err) => {
            if (ready) handlers.onError(err);
            else reject(err);
          },
        });
        socket.start({ eventDispatcher: dispatcher }).catch(reject);
      });
    },
    async createMessage(chatId, text) {
      const answer = await (await api()).im.message.create({
        params: { receive_id_type: "chat_id" },
        data: { receive_id: chatId, msg_type: "text", content: JSON.stringify({ text }) },
      });
      return toResult(answer);
    },
    async replyMessage(messageId, text) {
      const answer = await (await api()).im.message.reply({
        path: { message_id: messageId },
        data: { msg_type: "text", content: JSON.stringify({ text }) },
      });
      return toResult(answer);
    },
    close() {
      socket?.close();
      socket = undefined;
    },
  };
}

function toResult(answer: SdkApiAnswer): LarkApiResult {
  return {
    code: answer.code ?? -1,
    ...(answer.msg === undefined ? {} : { msg: answer.msg }),
    ...(answer.data?.message_id === undefined ? {} : { messageId: answer.data.message_id }),
  };
}
