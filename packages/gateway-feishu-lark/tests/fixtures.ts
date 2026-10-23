/** Fixtures shared by the Lark tests. */

/** An `im.message.receive_v1` event as the SDK's dispatcher hands it over: header fields on top. */
export function larkEvent(
  overrides: {
    eventId?: string;
    senderType?: string;
    messageType?: string;
    content?: string;
    chatType?: string;
  } = {},
): Record<string, unknown> {
  return {
    event_id: overrides.eventId ?? "ev_1",
    event_type: "im.message.receive_v1",
    sender: { sender_type: overrides.senderType ?? "user", sender_id: { open_id: "ou_alice" } },
    message: {
      message_id: "om_1",
      chat_id: "oc_chat",
      chat_type: overrides.chatType ?? "p2p",
      message_type: overrides.messageType ?? "text",
      content: overrides.content ?? JSON.stringify({ text: "hello" }),
    },
  };
}
