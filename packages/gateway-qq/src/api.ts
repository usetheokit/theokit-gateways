/**
 * QQ Bot HTTP client: access token and passive-reply sends.
 *
 * @public
 */

import type { QQAdapterOptions, QQFetch } from "./types.js";

const DEFAULT_API = "https://api.sgroup.qq.com";
const DEFAULT_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const REQUEST_TIMEOUT_MS = 30_000;
/** Refresh this long before the token's stated expiry. */
const TOKEN_MARGIN_MS = 60_000;

const defaultFetch: QQFetch = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { status: res.status, text: () => res.text() };
};

interface JsonBody {
  [key: string]: unknown;
}

/** The part of the OpenAPI the adapter calls. */
export class QQApi {
  private readonly doFetch: QQFetch;
  private cached: { value: string; expiresAt: number } | undefined;

  constructor(private readonly opts: QQAdapterOptions) {
    this.doFetch = opts.fetch ?? defaultFetch;
  }

  /** A valid access token, fetched again when missing, forced or about to expire. */
  async token(force = false): Promise<string> {
    const c = this.cached;
    if (!force && c !== undefined && c.expiresAt - TOKEN_MARGIN_MS > Date.now()) return c.value;
    const { status, body } = await this.request(
      this.opts.tokenUrl ?? DEFAULT_TOKEN_URL,
      "POST",
      {},
      { appId: this.opts.appId, clientSecret: this.opts.clientSecret },
    );
    const value = body.access_token;
    if (typeof value !== "string" || value === "") {
      throw new Error(`token answered HTTP ${status} without an access_token`);
    }
    this.cached = { value, expiresAt: Date.now() + (Number(body.expires_in) || 7200) * 1000 };
    return value;
  }

  forget(): void {
    this.cached = undefined;
  }

  /** The gateway WebSocket URL. */
  async gatewayUrl(): Promise<string> {
    const { status, body } = await this.authed("GET", "/gateway");
    if (typeof body.url !== "string" || body.url === "") {
      throw new Error(`gateway answered HTTP ${status} without a url`);
    }
    return body.url;
  }

  /** Send one text message; resolves the new message id, throws with QQ's code and message. */
  async sendText(
    scene: "c2c" | "group",
    target: string,
    content: string,
    reply: { msgId?: string; msgSeq: number },
  ): Promise<string> {
    const path =
      scene === "c2c"
        ? `/v2/users/${encodeURIComponent(target)}/messages`
        : `/v2/groups/${encodeURIComponent(target)}/messages`;
    const payload: JsonBody = { content, msg_type: 0 };
    if (reply.msgId !== undefined) {
      payload.msg_id = reply.msgId;
      payload.msg_seq = reply.msgSeq;
    }
    const { status, body } = await this.authed("POST", path, payload);
    if (status >= 300) {
      throw new Error(`QQ error ${String(body.code ?? status)}: ${String(body.message ?? "")}`);
    }
    return typeof body.id === "string" ? body.id : "";
  }

  private async authed(method: "GET" | "POST", path: string, payload?: JsonBody) {
    const token = await this.token();
    return this.request(
      (this.opts.apiBase ?? DEFAULT_API) + path,
      method,
      { Authorization: `QQBot ${token}` },
      payload,
    );
  }

  private async request(
    url: string,
    method: string,
    headers: Record<string, string>,
    payload?: JsonBody,
  ): Promise<{ status: number; body: JsonBody }> {
    const res = await this.doFetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const text = await res.text();
    try {
      return { status: res.status, body: JSON.parse(text) as JsonBody };
    } catch {
      throw new Error(`QQ answered HTTP ${res.status} with a non-JSON body`);
    }
  }
}
