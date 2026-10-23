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
  const o = {
    eventId: "ev_1",
    senderType: "user",
    messageType: "text",
    content: JSON.stringify({ text: "hello" }),
    chatType: "p2p",
    ...overrides,
  };
  return {
    event_id: o.eventId,
    event_type: "im.message.receive_v1",
    sender: { sender_type: o.senderType, sender_id: { open_id: "ou_alice" } },
    message: {
      message_id: "om_1",
      chat_id: "oc_chat",
      chat_type: o.chatType,
      message_type: o.messageType,
      content: o.content,
    },
  };
}
