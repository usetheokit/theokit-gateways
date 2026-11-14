import type { BasePlatformAdapter } from "@theokit/gateway";
import { channelRendering } from "@theokit/gateway";
import { ChatPresenter } from "@theokit/presenter";

/**
 * Renders `text` for the adapter's platform and sends it. Resolves `undefined` on success, or a
 * short failure code: the adapter's refusal code, or the thrown error's name. Never a message
 * or an id.
 *
 * @public
 */
export async function deliverText(
  adapter: BasePlatformAdapter,
  channelId: string,
  text: string,
): Promise<string | undefined> {
  try {
    const presenter = new ChatPresenter({
      channel: { id: channelId, type: "dm" },
      ...channelRendering(adapter.platform),
    });
    presenter.present({ type: "text", text });
    for (const message of presenter.present({ type: "finish" })) {
      const result = await adapter.sendMessage(message);
      if (!result.ok) return result.error?.code ?? "send failed";
    }
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.name : "unknown error";
  }
}
