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

```ts
const runner: GatewayRunner = new GatewayRunner({
  adapters: [telegram],
  secrets: [apiKey],
  handler: createAgentHandler({
    agentFor: async (event) => {
      const agent = await registry.agentFor(router.sessionKey(event));
      return { agent, release: () => registry.release(agent) };
    },
    adapter: (platform) => runner.adapter(platform), // lets `ackEmoji` react to the inbound message
    ackEmoji: "eyes", // best effort; a failing reaction never fails the turn
    secrets: [apiKey],
    progress: (output) => (output.type === "tool-call" ? `Running ${output.name}…` : undefined),
  }),
});
```
