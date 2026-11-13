import { describe, expect, it, vi } from "vitest";
import {
  type ChatCommand,
  commandHook,
  GatewayConfigurationError,
  parseChatCommand,
} from "../../src/index.js";

const ev = (text: string) => ({ text }) as never;
const call = (h: ReturnType<typeof commandHook>, text: string) =>
  h.pre_inbound?.({ event: ev(text) });

describe("parseChatCommand", () => {
  it.each(["/help", "<@U123> /help", "@bot /help", "/help@my_bot"])("parses %s", (t) => {
    expect(parseChatCommand(t)).toEqual({ name: "help", arg: "" });
  });
  it("parses mention, suffix and arg", () => {
    expect(parseChatCommand("<@U1> /usage@my_bot cost")).toEqual({ name: "usage", arg: "cost" });
  });
  it("returns undefined for non-commands", () => {
    expect(parseChatCommand("hello /help")).toBeUndefined();
    expect(parseChatCommand("help")).toBeUndefined();
    expect(parseChatCommand("@a @b /help")).toBeUndefined();
  });
});

describe("commandHook", () => {
  const run = vi.fn(() => ({ block: true, message: "ran" }));
  const cmds: ChatCommand[] = [
    { name: "new", description: "Start over", arg: "none", run },
    { name: "think", description: "Set level", usage: "/think off|low", run },
  ];
  it("answers /help in declaration order", async () => {
    const r = await call(commandHook(cmds), "/help");
    expect(r).toEqual({ block: true, message: "/new - Start over\n/think off|low - Set level" });
  });
  it("replies with usage for arg none and does not run", async () => {
    expect(await call(commandHook(cmds), "/new chat")).toEqual({ block: true, message: "/new" });
    expect(run).not.toHaveBeenCalled();
  });
  it("passes /newer and plain text through", async () => {
    expect(await call(commandHook(cmds), "/newer")).toBeUndefined();
    expect(await call(commandHook(cmds), "hi")).toBeUndefined();
  });
  it("runs a command with its arg", async () => {
    await call(commandHook(cmds), "@bot /think low");
    expect(run).toHaveBeenCalledWith(expect.anything(), "low");
  });
  it("throws duplicate_command", () => {
    const a = cmds[0] as ChatCommand;
    try {
      commandHook([a, a]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(GatewayConfigurationError);
      expect((e as GatewayConfigurationError).code).toBe("duplicate_command");
      expect((e as Error).message).toContain("new");
    }
  });
});
