# @theokit/gateway-agent

The glue between a TheoKit SDK agent and `@theokit/gateway` channels: run one turn to text, and
send text to a channel rendered for its platform. Peer dependencies: `@theokit/gateway`,
`@theokit/presenter`, `@theokit/sdk`.

## `runAgentText(agent, prompt, options?)`

Sends `prompt`, reads the stream through the presenter's `fromSdkMessage`, and concatenates the text.
Every send carries `toolResultGuard: { delimit: true }` (tool results reach the model framed as
data), merged over `options.sendOptions`.

```ts
const result = await runAgentText(agent, "What is on my calendar?");
if (result.ok) console.log(result.text);
else console.error(result.failure); // SDK error code, stream error code, or "no error code"
```

The turn failed when `wait()` reports `status: "error"` or the stream carried an error, even if
`wait()` says it finished. `text` holds whatever was streamed before the failure. `agent` is any
object matching `TurnAgent`, so tests can pass a fake.

## `deliverText(adapter, channelId, text)`

Renders `text` with `ChatPresenter` and `channelRendering(adapter.platform)`, then sends it with
`adapter.sendMessage`. Resolves `undefined` on success, or a short failure code: the adapter's refusal
code, or the thrown error's name. It never returns an error message or an id.

```ts
const failure = await deliverText(adapter, "C123", result.text);
```

## `createAgentHandler(options)`

Turns an SDK agent into a `GatewayHandler`: one agent turn per message and exactly one reply,
rendered with `ChatPresenter` and `channelRendering(event.platform)`. An empty answer replies
`noAnswerText` ("I could not come up with an answer to that."). A failed turn replies `errorText`
once and then throws `AgentTurnError` (`platform` and SDK `code`, no prompt text), so `on_error`
hooks fire. The lease from `agentFor` is always released. Values in `secrets` are masked from the
streamed text, including a value split across frames, and again from the final text. The handler
starts no typing indicator: `GatewayRunner` already shows and renews one.
`ackEmoji` reacts through `GatewayContext.react` when the context has one (a gateway release that adds it; the 0.20.x context has none). Otherwise pass `adapters` (the list you give `GatewayRunner`) and the reaction goes through the adapter for the event's platform. With neither path the reaction is skipped, a warning naming the gateway version is logged once, and the turn still runs and replies.

```ts
const runner = new GatewayRunner({
  adapters: [telegram],
  secrets: [apiKey],
  handler: createAgentHandler({
    agentFor: async (event) => {
      const agent = await registry.agentFor(router.sessionKey(event));
      return { agent, release: () => registry.release(agent) };
    },
    adapters: [telegram],
    ackEmoji: "eyes", // best effort; a failing reaction never fails the turn
    secrets: [apiKey],
    progress: (output) => (output.type === "tool-call" ? `Running ${output.name}…` : undefined),
  }),
});
```

## `gatewayDeliverPort(adapters, options?)` and `parseChannelTarget(spec)`

`gatewayDeliverPort` adapts gateway adapters to the `DeliverPort` of the `@theokit/agents` scheduler. `adapters` is read on every send, so a platform that connects later is reached. The text is masked with `options.secrets`, rendered for the platform and sent to the channel as a group. A failure is `{ ok: false, error: { code } }`: `not_started` (no adapter for the platform), the adapter's refusal code, or `adapter_threw`.

`parseChannelTarget("<platform>:<channelId>")` splits at the first colon (Matrix room ids keep theirs) and throws `GatewayConfigurationError` with code `invalid_channel_target` when a part is missing.

```ts
import { createScheduler } from "@theokit/agents/tools";
import { gatewayDeliverPort, parseChannelTarget } from "@theokit/gateway-agent";

// The adapters you pass to GatewayRunner; the list is read on every send.
const adapters = [slackAdapter, telegramAdapter];

const deliver = gatewayDeliverPort(() => adapters, { secrets: [process.env.API_KEY ?? ""] });
const scheduler = createScheduler({ store, run, deliver });

// A schedule line reads "0 9 * * * slack:C0123"; split its target with:
const target = parseChannelTarget("slack:C0123"); // { platform: "slack", channelId: "C0123" }
```

## `createChatApprover(options)`

`createChatApprover` takes `ChatApproverOptions` and returns a `ChatApprover` (`hook`, `ask`, `hasPending`). It asks an owner in chat to approve a tool call and waits for `/approve`, `/approve always` or `/deny`. Silence for `timeoutMs` (default 120 s), a failed send, an unknown conversation, or a question already pending in the same conversation all resolve `deny`. A non-owner is answered "Only an owner can do that." and the question stays pending. The three commands never reach the agent. `ask` takes the conversation key explicitly, so it does not depend on the SDK's approval context carrying one.

```ts
import { createChatApprover } from "@theokit/gateway-agent";
import type { Plugin } from "@theokit/sdk";

const approver = createChatApprover({
  conversationOf: (event) => `${event.platform}:${event.channel.id}`,
  isOwner: (event) => owners.has(`${event.platform}:${event.sender.id}`),
  // Adapters return `{ ok: false }` instead of throwing; throw so a failed question denies at once.
  send: async (event, text) => {
    const result = await adapterFor(event.platform).sendMessage({ channel: event.channel, text });
    if (!result.ok) throw new Error(result.error?.code ?? "send_failed");
  },
});

// 1. Register the hook with the runner: new GatewayRunner({ hooks: [approver.hook], ... })

// 2. Register a `pre_tool_call` handler on the agent. The SDK allows a call unless the handler
//    returns `{ block: true, message }`, so an approval is `undefined` and a denial is a block.
const alwaysAllowed = new Set<string>(); // persist this yourself if "always" must survive restarts

const approvals: Plugin = {
  kind: "general",
  name: "chat-approvals",
  version: "1.0.0",
  register(ctx) {
    ctx.on("pre_tool_call", async ({ name, args, agentId }) => {
      if (!needsApproval(name, args) || alwaysAllowed.has(name)) return undefined;
      // The context carries no conversation: map the agent back to the one it answers in.
      const conversation = conversationOfAgent(agentId);
      const { answer } = await approver.ask(conversation, `${name} ${JSON.stringify(args)}`);
      if (answer === "deny") {
        return { block: true, message: `The owner did not approve ${name}. Do not retry it.` };
      }
      if (answer === "always") alwaysAllowed.add(name); // skip the question from now on
      return undefined;
    });
  },
};
// Agent.create({ plugins: [approvals], ... })
```
