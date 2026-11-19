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
