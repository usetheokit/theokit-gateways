/**
 * The content of a Matrix `m.replace` event — how an edit is expressed on Matrix.
 *
 * Matrix has no call that changes an event. An edit is a NEW event whose `m.relates_to` names the
 * original with `rel_type: "m.replace"` and whose `m.new_content` holds the replacement; clients
 * that understand replacements render `m.new_content` over the original, and the rest show the
 * outer `body`, which carries the conventional `* ` prefix (Matrix Client-Server API v1.12,
 * § Event replacements).
 *
 * `formatted_body` follows the rule `sendMessage` follows: only `format: "html"` may declare
 * `org.matrix.custom.html`, because the declaration promises every client the field IS HTML.
 *
 * @internal
 */

import type { OutboundMessage } from "@theokit/gateway";

const HTML_FORMAT = "org.matrix.custom.html";

/** The `m.text` content for `text`, with `formatted_body` only when the caller declared html. */
function textContent(text: string, html: boolean): Record<string, unknown> {
  return html
    ? { msgtype: "m.text", body: text, format: HTML_FORMAT, formatted_body: text }
    : { msgtype: "m.text", body: text };
}

/** Build the content of an event that replaces `originalEventId` with `out.text`. */
export function replaceContent(
  originalEventId: string,
  out: OutboundMessage,
): Record<string, unknown> {
  const html = out.format === "html";
  return {
    ...textContent(`* ${out.text}`, html),
    "m.new_content": textContent(out.text, html),
    "m.relates_to": { rel_type: "m.replace", event_id: originalEventId },
  };
}
