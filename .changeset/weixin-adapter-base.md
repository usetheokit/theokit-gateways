---
"@theokit/gateway": minor
"@theokit/gateway-wechat": patch
"@theokit/gateway-wecom": patch
---

`@theokit/gateway` exports `WeixinAdapterBase` and `parseFlatXml`: the token, send and dispatch flow and the XML reader that the WeChat and WeCom adapters used to carry a copy each. Both adapters now extend the base; behavior is unchanged. Their peer floor is now `>=0.15.0`.
