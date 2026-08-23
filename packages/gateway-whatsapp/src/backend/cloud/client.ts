/**
 * `WhatsAppCloudClient` — typed `fetch` wrapper for Meta WhatsApp Business
 * Cloud API (ADR D304). No Meta SDK; we own the wire.
 *
 * @internal
 */

import type { WhatsAppCredentialCheck, WhatsAppSendResult } from "../../backend-types.js";
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
   * Ask Meta whether this credential can actually act as this phone number.
   *
   * `connect()` used to answer that question with `return true`, so a wrong, expired or revoked
   * token reported success at startup and surfaced as messages that silently never arrived —
   * the worst failure mode a gateway has, because there is nothing in a log to see. The first
   * live run of the WhatsApp suite caught it (#58); 209 unit tests could not, because a fake
   * backend always accepts.
   *
   * It reads the phone number itself rather than `/me`, and that choice is the point: a token
   * can be perfectly valid and still have no access to THIS phone number id, which is the
   * likelier misconfiguration of the two. Checking only the token would wave it through.
   *
   * Returns a result rather than a boolean, and never throws — `connect()` is specified to
   * return false rather than throw, and the reason has to survive the trip: `auth_failed` and
   * `rate_limit` ask a supervisor for opposite responses.
   */
  async verifyCredentials(): Promise<WhatsAppCredentialCheck> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl, {
        method: "GET",
        headers: { authorization: `Bearer ${this.opts.accessToken}` },
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

    const body = (await response.json().catch(() => undefined)) as
      | (MetaErrorEnvelope & { id?: unknown })
      | undefined;

    if (!response.ok) {
      return { ok: false, error: mapWhatsAppCloudError(response.status, body ?? {}) };
    }
    // A 200 is not a yes. Meta answers some failures with an error envelope under a 200, and a
    // captive portal or proxy answers everything with one — so the status line is the weakest
    // evidence in the response.
    if (body === undefined) {
      return {
        ok: false,
        error: {
          code: "unknown",
          message: `Meta answered ${response.status} with a body this client could not read.`,
        },
      };
    }
    if (body.error !== undefined) {
      return { ok: false, error: mapWhatsAppCloudError(response.status, body) };
    }
    // IDENTITY, not access — the distinction this method exists for, and the one its first
    // version claimed while checking only the other. `GET /{waba_id}` with a management-scoped
    // token also answers 200, so pasting the WABA id where the phone number id belongs sails
    // through an access check and fails on every send afterwards. It is the likeliest
    // misconfiguration in Cloud API setup, and the response names the node it actually reached.
    if (body.id !== this.opts.phoneNumberId) {
      return {
        ok: false,
        error: {
          code: "invalid_request",
          message:
            `Credential is valid but resolves to node ${String(body.id)}, not the configured ` +
            `phoneNumberId ${this.opts.phoneNumberId}. A WhatsApp Business Account id in place ` +
            `of a phone number id looks exactly like this.`,
        },
      };
    }
    return { ok: true };
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
