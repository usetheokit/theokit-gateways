/**
 * `ChannelDescriptor` — one platform's channel described as data (FR-001, ADR D1 of B-018).
 *
 * A platform package exports one static descriptor: the config fields its channel needs, how to
 * build its adapter from them, and, for a channel that receives webhooks, how to verify and ingest
 * a request. An app then wires every channel with the same loop (`createChannels`) instead of one
 * branch per platform. The core only reads these shapes; it never names a platform.
 *
 * @public
 */

import type { BasePlatformAdapter } from "../adapter/base.js";
import type { PlatformName } from "../types/message-event.js";

/** One configuration field a channel reads. */
export interface ChannelConfigField {
  /** The key `create` reads from its config object. */
  readonly key: string;
  /** A required field that is absent, `null` or `""` rejects the channel before `create` runs. */
  readonly required: boolean;
  /** The value is a credential: never log it, and keep it out of anything shown to a user. */
  readonly secret: boolean;
  /** What the field is, for a human configuring the channel. */
  readonly description: string;
}

/** A webhook request as the app's HTTP layer received it, before anything parsed the body. */
export interface WebhookRequest {
  /** The exact request bytes as text; signatures are computed over them. */
  readonly rawBody: string;
  /** Request headers. Descriptors look a header up without regard to case. */
  readonly headers: Readonly<Record<string, string | undefined>>;
}

/**
 * What `ingest` did with a verified payload: `"delivered"` dispatched it, `"malformed"` refused it
 * without dispatching, and `"no_handler"` dispatched nothing because the payload holds a message
 * for the handler and none is subscribed (before the runner starts, after it stops, or for an
 * adapter whose connect failed under `connectFailure: "isolate"`). Answer only `"delivered"` with
 * a success status, so a platform that redelivers can send the rest again.
 */
export type IngestResult = "delivered" | "malformed" | "no_handler";

/**
 * The webhook half of a channel: verify a request, then hand its payload to the adapter.
 *
 * `verify` and `ingest` are declared as methods on purpose. Method parameters are bivariant, which
 * is what lets a descriptor typed for its own adapter class sit in a list of
 * `ChannelDescriptor<BasePlatformAdapter>`; written as function-typed properties, that assignment
 * would fail under `strictFunctionTypes`.
 */
export interface ChannelWebhook<TAdapter extends BasePlatformAdapter> {
  /** `true` when the request carries a valid signature for this adapter's credentials. */
  verify(adapter: TAdapter, request: WebhookRequest): boolean;
  /** Dispatch a parsed, verified payload, or report it malformed without dispatching. */
  ingest(adapter: TAdapter, payload: unknown): Promise<IngestResult>;
}

interface ChannelDescriptorBase<TAdapter extends BasePlatformAdapter> {
  /** The platform the built adapter reports as its `platform`. */
  readonly platform: PlatformName;
  /** Every field `create` reads. */
  readonly config: ReadonlyArray<ChannelConfigField>;
  /**
   * Build the adapter. Throws a `GatewayConfigurationError` (or a subclass) for a value it refuses,
   * which `createChannels` reports as a rejected channel; it performs no network call.
   */
  create(config: Readonly<Record<string, unknown>>): TAdapter;
}

/**
 * A channel described as data. A `socket` channel opens its own connection to the platform; a
 * `webhook` channel receives requests the app routes to `webhook.verify` and `webhook.ingest`.
 *
 * @public
 */
export type ChannelDescriptor<TAdapter extends BasePlatformAdapter = BasePlatformAdapter> =
  | (ChannelDescriptorBase<TAdapter> & { readonly transport: "socket"; readonly webhook?: never })
  | (ChannelDescriptorBase<TAdapter> & {
      readonly transport: "webhook";
      readonly webhook: ChannelWebhook<TAdapter>;
    });
