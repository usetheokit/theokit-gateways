/**
 * Read the flat XML the Tencent webhook platforms (WeChat, WeCom) push:
 * `<xml><Tag><![CDATA[v]]></Tag>…</xml>`. The messages these adapters take have no nesting, so a
 * tag scan is enough and no XML library is needed.
 *
 * @public
 */
export function parseFlatXml(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const tag = /<([A-Za-z][A-Za-z0-9]*)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g;
  for (const m of xml.matchAll(tag)) {
    const name = m[1];
    if (name !== undefined && name !== "xml") out[name] = m[2] ?? decodeEntities(m[3] ?? "");
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
