import { parseFlatXml } from "@theokit/gateway";

/**
 * Read the flat XML WeCom pushes: `<xml><Tag><![CDATA[v]]></Tag>…</xml>`. The messages this
 * adapter takes have no nesting, so a tag scan is enough and no XML library is needed.
 */
export function parseWeComXml(xml: string): Record<string, string> {
  return parseFlatXml(xml);
}
