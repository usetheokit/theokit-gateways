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

Around the turn:

- `decorateReply(reply, outcome)` returns the text to send, for example with a usage footer
  (`outcome.usage`). It goes out in the same single reply and is masked again. A throw sends the
  undecorated reply. It runs for successful turns only.
- `onTurnEnd(event, outcome)` runs once per turn, after the reply attempt, with
  `{ text, failed, code?, usage? }`. `failed` is true for an errored or cancelled run, an
  unexpected error, or a refused reply. Errors it throws are ignored.
- `onTurnStart(event, { agent, run })` runs once the run has started. Keep the turn in your own
  registry under the session key (`router.sessionKey(event)`) and a later message for the same
  session can call `run.cancel()` or your SDK's steering on `agent`. Return an unregister function;
  it runs when the turn ends. Delete only if the entry is still yours, since a newer turn on the
  same session may have replaced it.

```ts
const running = new Map<string, RunningTurn>();
createAgentHandler({
  agentFor,
  onTurnStart: (event, turn) => {
    const key = router.sessionKey(event);
    running.set(key, turn);
    return () => {
      if (running.get(key) === turn) running.delete(key);
    };
  },
  decorateReply: (reply, { usage }) => `${reply}\n\n(${usage?.outputTokens ?? "?"} tokens)`,
});
```

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

## `createTrigger(options)` and `frameUntrusted(tag, body, attributes?)`

`createTrigger` runs a fresh agent on each signed webhook and sends the answer to a channel. `handle(request)` answers 401 for a bad signature (the body is not read), 400 for a delivery id over 256 chars, 503 while the reply adapter is not started (the id is not remembered, so the sender's retry runs), 200 for a delivery id seen before (the last `rememberDeliveries`, default 1000, are kept), and otherwise 202 at once while the run continues in the background. The prompt is `instructions`, a fixed untrusted-data notice, then the body framed by `frameUntrusted("payload", body)`, which escapes a forged closing tag. A failed run or undelivered reply is written as one line holding a code only. `idle()` resolves when every started run has ended. `verify` takes any function of theokit's `VerifyFn` shape, so this package does not depend on `theokit`.

```ts
import { github } from "theokit/server/webhook";
import { createTrigger } from "@theokit/gateway-agent";

const trigger = createTrigger({
  name: "github",
  verify: github({ secret: process.env.GITHUB_WEBHOOK_SECRET ?? "" }),
  dedupeHeader: "x-github-delivery",
  instructions: "Summarise this GitHub event in two sentences.",
  deliverTo: () => ({ adapter: slackAdapter, channelId: "C0123" }),
  agent: async () => {
    const agent = await registry.agentFor("github-trigger");
    return { agent, release: () => registry.release(agent) };
  },
  secrets: [apiKey],
  write: (line) => console.error(line),
});

// In your host's route for /hooks/github:
//   return trigger.handle(request);
await trigger.idle(); // on shutdown
```

## `createChatApprover(options)`

Asks an owner in the chat to approve a tool call and waits for `/approve`, `/approve always` or `/deny`.
`ask` resolves `deny` when no message was seen in the conversation, when a question is already pending
there, when `send` throws, and after `timeoutMs` (default 120 s). Only an owner's answer counts; a
non-owner is told "Only an owner can do that." and the question stays open. The hook blocks the three
commands in every case. Register it before the agent handler, and use the same key in `conversationOf`
and `ask`.

```ts
import { PermissionEngine, PermissionPlugin } from "@theokit/sdk";

const approver = createChatApprover({
  conversationOf: (event) => router.sessionKey(event),
  isOwner: (event) => owners.has(`${event.platform}:${event.sender.id}`),
  send: async (event, text) => {
    const result = await adapterFor(event.platform).sendMessage({ channel: event.channel, text });
    // sendMessage reports failure in its result; throw so the question resolves as a deny.
    if (!result.ok) throw new Error(result.error?.message ?? "send failed");
  },
});

// GatewayRunner({ hooks: [approver.hook], handler, ... })

// Build the permission plugin for one conversation, so the key is explicit.
function permissionPluginFor(conversation: string, engine: PermissionEngine) {
  return PermissionPlugin.create(engine, {
    canUseTool: async (toolName, input) => {
      const { answer } = await approver.ask(conversation, `${toolName} ${JSON.stringify(input)}`);
      return answer === "deny"
        ? { behavior: "deny", message: "Not approved in chat." }
        : { behavior: "allow" };
    },
  });
}
```

`canUseTool` is only consulted when the permission engine's verdict is `ask`. `/approve always`
answers `always`; remembering it (for example by adding an allow rule to the engine) is up to the app.
