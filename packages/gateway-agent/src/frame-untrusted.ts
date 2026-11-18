const TAG_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\r\n]+/g, " ");
}

/**
 * Wraps untrusted text in a named tag, escaping a forged closing tag (`</tag`, any case) so the
 * body cannot end the frame early. Attribute values are escaped too. Throws `TypeError` when `tag`
 * or an attribute name is not a plain name.
 *
 * @public
 */
export function frameUntrusted(
  tag: string,
  body: string,
  attributes: Record<string, string> = {},
): string {
  if (!TAG_NAME.test(tag)) throw new TypeError("frameUntrusted: invalid tag name");
  let attrs = "";
  for (const [name, value] of Object.entries(attributes)) {
    if (!TAG_NAME.test(name)) throw new TypeError("frameUntrusted: invalid attribute name");
    attrs += ` ${name}="${escapeAttribute(value)}"`;
  }
  const closing = new RegExp(`</(?=${tag}(?![A-Za-z0-9_-]))`, "gi");
  const safe = body.replace(closing, "&lt;/");
  return `<${tag}${attrs}>\n${safe}\n</${tag}>`;
}
