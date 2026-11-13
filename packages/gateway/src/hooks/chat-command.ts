/**
 * Chat command parsing and a single `pre_inbound` hook for many commands.
 *
 * Recognises a command behind one leading mention (`<@U123> /help`,
 * `@bot /help`) and with Telegram's `@botname` suffix (`/help@my_bot`).
 * The name is matched exactly: `/new chat` is `/new` with arg `chat`,
 * `/newer` is never `/new`.
 *
 * @public
 */

import { GatewayConfigurationError } from "../errors/config-error.js";
import type { MessageEvent } from "../types/message-event.js";
import type { GatewayHook, HookDecision } from "./types.js";

/** A parsed chat command. */
export interface ParsedChatCommand {
  /** Command name, without the prefix and without `@bot`. */
  readonly name: string;
  /** Trimmed rest of the text, `""` when none. */
  readonly arg: string;
}

const LEADING_MENTION = /^(?:<@[^>]+>|@\S+)\s+/;
const DEFAULT_PREFIXES: ReadonlyArray<string> = ["/"];

function matchPrefix(text: string, prefixes: ReadonlyArray<string>): string | undefined {
  let best: string | undefined;
  for (const p of prefixes) {
    if (p.length > 0 && text.startsWith(p) && (best === undefined || p.length > best.length)) {
      best = p;
    }
  }
  return best;
}

/**
 * Strips one leading `<@U...>` or `@name` mention and a `@bot` suffix.
 * Returns `undefined` for text that is not a command.
 */
export function parseChatCommand(
  text: string,
  options?: { prefixes?: ReadonlyArray<string> },
): ParsedChatCommand | undefined {
  const body = text.trim().replace(LEADING_MENTION, "");
  const prefix = matchPrefix(body, options?.prefixes ?? DEFAULT_PREFIXES);
  if (prefix === undefined) return undefined;
  const rest = body.slice(prefix.length);
  const m = /^([^\s@]+)(?:@\S+)?(?:\s+([\s\S]*))?$/.exec(rest);
  if (!m?.[1]) return undefined;
  return { name: m[1].toLowerCase(), arg: (m[2] ?? "").trim() };
}

/** One command handled by {@link commandHook}. */
export interface ChatCommand {
  readonly name: string;
  readonly description: string;
  /** Default `"optional"`. */
  readonly arg?: "none" | "optional" | "required";
  /** Usage line shown in help. Default `"/<name>"`. */
  readonly usage?: string;
  run(
    event: MessageEvent,
    arg: string,
  ): HookDecision | undefined | Promise<HookDecision | undefined>;
}

function usageOf(c: ChatCommand): string {
  return c.usage ?? `/${c.name}`;
}

/** Help text listing every command's usage and description, in declaration order. */
export function helpText(commands: ReadonlyArray<ChatCommand>): string {
  return commands.map((c) => `${usageOf(c)} - ${c.description}`).join("\n");
}

function assertUnique(names: ReadonlyArray<string>): void {
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.toLowerCase();
    if (seen.has(name)) {
      throw new GatewayConfigurationError("gateway", {
        code: "duplicate_command",
        message: `gateway: duplicate_command: ${raw}`,
        detail: raw,
      });
    }
    seen.add(name);
  }
}

function badArity(c: ChatCommand, arg: string): boolean {
  const mode = c.arg ?? "optional";
  return (mode === "none" && arg !== "") || (mode === "required" && arg === "");
}

/**
 * One `pre_inbound` hook for many commands. Also answers `/help`
 * (rename with `helpCommand`, disable with `false`).
 */
export function commandHook(
  commands: ReadonlyArray<ChatCommand>,
  options?: { name?: string; helpCommand?: string | false },
): GatewayHook {
  const helpName = options?.helpCommand === undefined ? "help" : options.helpCommand;
  assertUnique([...commands.map((c) => c.name), ...(helpName === false ? [] : [helpName])]);
  const byName = new Map(commands.map((c) => [c.name.toLowerCase(), c]));
  const help = helpText(commands);

  return {
    name: options?.name ?? "chat-commands",
    async pre_inbound({ event }) {
      const parsed = parseChatCommand(event.text);
      if (!parsed) return undefined;
      if (helpName !== false && parsed.name === helpName.toLowerCase()) {
        return { block: true, message: help };
      }
      const command = byName.get(parsed.name);
      if (!command) return undefined;
      if (badArity(command, parsed.arg)) return { block: true, message: usageOf(command) };
      return command.run(event, parsed.arg);
    },
  };
}
