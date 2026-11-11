import { parseFlatXml } from "@theokit/gateway";

/**
 * Read the flat XML WeChat pushes: `<xml><Tag><![CDATA[v]]></Tag>…</xml>`. The messages this
 * adapter takes have no nesting, so a tag scan is enough and no XML library is needed.
 */
export function parseWeChatXml(xml: string): Record<string, string> {
  return parseFlatXml(xml);
}
