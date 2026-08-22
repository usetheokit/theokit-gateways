/**
 * `WhatsAppCloudClient` — typed `fetch` wrapper for Meta WhatsApp Business
 * Cloud API (ADR D304). No Meta SDK; we own the wire.
 *
 * @internal
 */

import type { WhatsAppSendResult } from "../../backend-types.js";
import { mapWhatsAppCloudError } from "../../errors.js";
import type {
  MetaErrorEnvelope,
  MetaMarkReadRequest,
  MetaSendResponse,
  MetaSendTemplateRequest,
  MetaSendTextRequest,
  MetaTemplateComponent,
} from "./types.js";

interface WhatsAppCloudClientOptions {
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly apiVersion?: string;
  /** Test seam. */
  readonly fetch?: typeof fetch;
}

export class WhatsAppCloudClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly opts: WhatsAppCloudClientOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    const apiVersion = opts.apiVersion ?? "v18.0";
    this.baseUrl = `https://graph.facebook.com/${apiVersion}/${opts.phoneNumberId}`;
  }

  /** Send a text message. v1 scope — no media (D286 deferred). */
  async sendText(to: string, body: string, isGroup: boolean): Promise<WhatsAppSendResult> {
    const req: MetaSendTextRequest = isGroup
      ? {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body, preview_url: false },
        }
      : {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body, preview_url: false },
        };

    return this.postMessage(req);
  }

  /**
   * Send an approved template.
   *
   * The only message type Meta accepts outside the 24-hour service window, and so the only way to
   * reach someone who has not written first — every notification, and every unattended check of
   * whether this integration still works. Free-form text to a cold recipient is refused with
   * `131047`, which the error mapper now surfaces as `session_window_expired`.
   *
   * `components` is omitted from the payload when absent rather than sent empty: Meta rejects
   * `components: []` on a template that declares no variables, so the two are not equivalent.
   *
   * Deliberately NOT on the `WhatsAppBackend` interface. The web backend drives WhatsApp Web,
   * which has no concept of templates, and widening the shared contract would hand it a method it
   * can only throw from.
   */
  async sendTemplate(
    to: string,
    templateName: string,
    languageCode: string,
    components?: ReadonlyArray<MetaTemplateComponent>,
  ): Promise<WhatsAppSendResult> {
    const req: MetaSendTemplateRequest = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components !== undefined && components.length > 0 ? { components } : {}),
      },
    };
    return this.postMessage(req);
  }

  /**
   * POST one message envelope and turn Meta's answer into a `WhatsAppSendResult`.
   *
   * Shared by every send: how to reach the endpoint, how to authenticate, and how to read the
   * reply is one piece of knowledge, and it was about to have a second copy.
   */
  private async postMessage(
    req: MetaSendTextRequest | MetaSendTemplateRequest,
  ): Promise<WhatsAppSendResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.opts.accessToken}`,
        },
        body: JSON.stringify(req),
      });
    } catch (cause) {
      return {
        ok: false,
        error: {
          code: "server_error",
          message: `Network error: ${cause instanceof Error ? cause.message : String(cause)}`,
        },
      };
    }

    if (!response.ok) {
      const errBody = (await response.json().catch(() => ({}))) as MetaErrorEnvelope | unknown;
      return { ok: false, error: mapWhatsAppCloudError(response.status, errBody) };
    }

    const data = (await response.json()) as MetaSendResponse;
    const wamid = data.messages?.[0]?.id;
    if (wamid === undefined) {
      return { ok: false, error: { code: "unknown", message: "Meta returned no wamid." } };
    }
    return { ok: true, wamid };
  }

  /** Mark an inbound message as read (status receipt back to user). */
  async markAsRead(wamid: string): Promise<boolean> {
    const body: MetaMarkReadRequest = {
      messaging_product: "whatsapp",
      status: "read",
      message_id: wamid,
    };
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.opts.accessToken}`,
        },
        body: JSON.stringify(body),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
