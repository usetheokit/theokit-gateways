import { describe, expect, it, vi } from "vitest";
import { TelegramAdapter } from "../src/adapter.js";
import { telegramChannel } from "../src/channel.js";
import { ConfigurationError } from "../src/errors.js";

const ME = { id: 42, is_bot: true, first_name: "B", username: "TheoBot" };

function make(requireMention?: boolean, identity = true) {
  const adapter = new TelegramAdapter({
    token: "1:t",
    ...(requireMention === undefined ? {} : { requireMention }),
  });
  const bot = adapter.getBot();
  if (identity) bot.botInfo = ME as never;
  const seen: string[] = [];
  adapter.onInbound(async (e) => {
    seen.push(e.text);
  });
  return { adapter, bot, seen };
}

let n = 0;
function message(chatType: string, text: string, replyFrom?: number) {
  n += 1;
  return {
    message_id: n,
    date: 1,
    chat: { id: chatType === "private" ? 5 : -5, type: chatType },
    from: { id: 7, is_bot: false, first_name: "U" },
    text,
    ...(replyFrom === undefined
      ? {}
      : { reply_to_message: { message_id: 1, date: 1, from: { id: replyFrom } } }),
  };
}

async function polled(bot: ReturnType<typeof make>["bot"], msg: ReturnType<typeof message>) {
  await bot.handleUpdate({ update_id: n, message: msg } as never);
}

async function delivered(adapter: TelegramAdapter, msg: ReturnType<typeof message>) {
  const { buildEvent } = await import("../src/parse-inbound.js");
  const event = buildEvent(msg.chat, msg, msg.from, { update_id: n, message: msg });
  await adapter.deliver(event);
}

describe("requireMention", () => {
  for (const path of ["polled", "deliver"] as const) {
    const send = async (c: ReturnType<typeof make>, m: ReturnType<typeof message>) =>
      path === "polled" ? polled(c.bot, m) : delivered(c.adapter, m);

    it(`${path}: drops an unmentioned group message`, async () => {
      const c = make(true);
      await send(c, message("supergroup", "hello"));
      expect(c.seen).toEqual([]);
    });

    it(`${path}: dispatches mention, reply to bot, command and DM`, async () => {
      const c = make(true);
      await send(c, message("group", "hi @theobot"));
      await send(c, message("group", "hi", 42));
      await send(c, message("group", "/help"));
      await send(c, message("private", "plain"));
      expect(c.seen).toEqual(["hi @theobot", "hi", "/help", "plain"]);
    });

    it(`${path}: a reply to someone else is dropped`, async () => {
      const c = make(true);
      await send(c, message("group", "hi", 99));
      expect(c.seen).toEqual([]);
    });

    it(`${path}: option unset dispatches every group message`, async () => {
      const c = make();
      await send(c, message("group", "hello"));
      expect(c.seen).toEqual(["hello"]);
    });

    // grammy itself refuses a polled update before init, so only deliver() can see it.
    const unknownIdentity = path === "deliver" ? it : it.skip;
    unknownIdentity(`${path}: unknown identity drops with one stderr line`, async () => {
      const c = make(true, false);
      const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      await send(c, message("group", "@theobot"));
      await send(c, message("group", "@theobot"));
      const lines = write.mock.calls.filter((a) => String(a[0]).includes("requireMention"));
      write.mockRestore();
      expect(c.seen).toEqual([]);
      expect(lines).toHaveLength(1);
    });
  }

  it("channel config rejects a non-boolean requireMention", () => {
    let err: unknown;
    try {
      telegramChannel.create({ token: "t", requireMention: "yes" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigurationError);
    expect((err as ConfigurationError).code).toBe("invalid_config");
    expect((err as ConfigurationError).message).toContain("requireMention");
  });
});
