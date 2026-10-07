/**
 * The verifier and the SDK derive the Bot Framework key-set URL by replacing a trailing
 * `/openidconfiguration` with `/keys`. A `cloud.openIdMetadataUrl` that ends any other way used to
 * be fetched as the key set itself, so every request was refused as `key_set_unavailable`, which
 * says a retry may succeed, for as long as the configuration stood. It is refused when the verifier
 * is built, naming the option (B-420, review finding #95).
 */

import { describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { CLIENT_ID } from "./helpers/key-server.js";

const cloudWith = (openIdMetadataUrl: string) => ({
  loginEndpoint: "https://login.microsoftonline.com",
  tokenIssuer: "https://api.botframework.com",
  openIdMetadataUrl,
});

describe("cloud.openIdMetadataUrl", () => {
  it.each([
    [
      "the OIDC-standard spelling",
      "https://login.botframework.com/v1/.well-known/openid-configuration",
    ],
    ["a trailing slash", "https://login.botframework.com/v1/.well-known/openidconfiguration/"],
    ["a query string", "https://login.botframework.com/v1/.well-known/openidconfiguration?x=1"],
    ["the key-set URL itself", "https://login.botframework.com/v1/.well-known/keys"],
  ])("refuses %s at construction with a TypeError naming the option and the suffix", (_, url) => {
    expect(() => teamsActivityVerifier({ clientId: CLIENT_ID, cloud: cloudWith(url) })).toThrow(
      TypeError,
    );
    expect(() => teamsActivityVerifier({ clientId: CLIENT_ID, cloud: cloudWith(url) })).toThrow(
      /cloud\.openIdMetadataUrl must end in \/openidconfiguration/,
    );
  });

  it.each([
    ["public", "https://login.botframework.com/v1/.well-known/openidconfiguration"],
    ["US government", "https://login.botframework.azure.us/v1/.well-known/openidconfiguration"],
    ["China", "https://login.botframework.azure.cn/v1/.well-known/openidconfiguration"],
  ])("accepts the SDK's %s cloud URL", (_, url) => {
    expect(() =>
      teamsActivityVerifier({ clientId: CLIENT_ID, cloud: cloudWith(url) }),
    ).not.toThrow();
  });
});
