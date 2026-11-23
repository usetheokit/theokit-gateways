import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createVoiceCallHandler } from "../src/voice-call-handler.js";

const TOKEN = "tok";
const URL_ = "https://x.test/voice";

function signed(fields: Record<string, string>, bad = false): Request {
  const p = new URLSearchParams(fields);
  let data = URL_;
  for (const k of Object.keys(fields).sort()) data += k + fields[k];
  const sig = createHmac("sha1", TOKEN).update(data).digest("base64");
  return new Request(URL_, {
    method: "POST",
    headers: { "X-Twilio-Signature": bad ? "nope" : sig },
    body: p.toString(),
  });
}

afterEach(() => vi.useRealTimers());

function make() {
  const turns: string[] = [];
  const handler = createVoiceCallHandler({
    authToken: TOKEN,
    allowed: ["+1555"],
    goodbye: /\bbye\b/i,
    maxSilence: 1,
    turn: ({ text }) => {
      turns.push(text);
      return `you said ${text}`;
    },
  });
  return { handler, turns };
}

const call = { From: "+1555", CallSid: "CA1" };

describe("createVoiceCallHandler", () => {
  it("answers an allowed caller with a gather", async () => {
    const { handler } = make();
    const xml = await (await handler(signed(call))).text();
    expect(xml).toContain('<Gather action="https://x.test/voice" input="speech"');
    expect(xml).toContain('speechTimeout="auto" method="POST"');
  });
  it("hangs up on a caller outside the list without calling turn", async () => {
    const { handler, turns } = make();
    const xml = await (
      await handler(signed({ ...call, From: "+1666", SpeechResult: "hi" }))
    ).text();
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Gather");
    expect(turns).toEqual([]);
  });
  it("runs a turn, ends on goodbye", async () => {
    const { handler, turns } = make();
    const xml = await (await handler(signed({ ...call, SpeechResult: "hello" }))).text();
    expect(xml).toContain("you said hello");
    expect(turns).toEqual(["hello"]);
    const end = await (await handler(signed({ ...call, SpeechResult: "ok bye" }))).text();
    expect(end).toContain("<Hangup/>");
    expect(turns).toEqual(["hello"]);
  });
  it("hangs up after too much silence", async () => {
    const { handler } = make();
    expect(await (await handler(signed(call))).text()).toContain("<Gather");
    expect(await (await handler(signed(call))).text()).toContain("<Hangup/>");
  });
  it("allows exactly maxSilence silent turns before hanging up", async () => {
    const handler = createVoiceCallHandler({
      authToken: TOKEN,
      allowed: ["+1555"],
      turn: () => "x",
      maxSilence: 2,
    });
    await handler(signed(call)); // greeting, not a silent turn
    expect(await (await handler(signed(call))).text()).toContain("<Gather"); // silent 1
    expect(await (await handler(signed(call))).text()).toContain("<Hangup/>"); // silent 2
  });
  it("drops the state of an abandoned call", async () => {
    vi.useFakeTimers();
    const { handler } = make(); // maxSilence 1
    await handler(signed(call)); // greeting, state stored
    vi.setSystemTime(Date.now() + 2 * 3_600_000);
    // another call triggers the sweep
    await handler(signed({ ...call, CallSid: "CA2" }));
    // CA1 comes back: its state is gone, so it is greeted again instead of hung up on
    expect(await (await handler(signed(call))).text()).toContain("<Gather");
  });
  it("a completed status clears state and hangs up", async () => {
    const { handler } = make();
    await handler(signed(call));
    const xml = await (await handler(signed({ ...call, CallStatus: "completed" }))).text();
    expect(xml).toContain("<Hangup/>");
    // state gone: next silent request greets again rather than hanging up
    expect(await (await handler(signed(call))).text()).toContain("<Gather");
  });
  it("returns 400 without From or CallSid", async () => {
    const { handler } = make();
    expect((await handler(signed({ CallSid: "CA1" }))).status).toBe(400);
    expect((await handler(signed({ From: "+1555" }))).status).toBe(400);
  });
  it("rejects a bad signature", async () => {
    const { handler } = make();
    expect((await handler(signed(call, true))).status).toBe(403);
  });
});
