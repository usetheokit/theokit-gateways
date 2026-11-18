/**
 * A turn that failed. Carries the platform and the SDK error code only: never the prompt, the
 * answer or an error message from the model.
 *
 * @public
 */
export class AgentTurnError extends Error {
  readonly platform: string;
  readonly code: string;

  constructor(platform: string, code: string) {
    super(`agent turn failed on ${platform}: ${code}`);
    this.name = "AgentTurnError";
    this.platform = platform;
    this.code = code;
  }
}

/**
 * `ackEmoji` is set but the reaction cannot be sent: the context has no `react` (gateway below
 * 0.20) and no adapter for the platform was given in `adapters`. A configuration error, raised
 * before the turn runs rather than skipping the reaction silently.
 *
 * @public
 */
export class AckReactionUnavailableError extends Error {
  readonly platform: string;
  readonly gatewayVersion: string;

  constructor(platform: string, gatewayVersion: string) {
    super(
      `ackEmoji is set but @theokit/gateway ${gatewayVersion} gives no ctx.react and no adapter for ${platform} was passed in \`adapters\``,
    );
    this.name = "AckReactionUnavailableError";
    this.platform = platform;
    this.gatewayVersion = gatewayVersion;
  }
}
