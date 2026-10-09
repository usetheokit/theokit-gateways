/**
 * The verifier fetches its signing keys from the cloud's endpoints, so an endpoint configured with
 * plain `http:` would let anyone on the network path substitute the key set. Construction refuses
 * a cloud endpoint whose scheme is not `https:`, naming the field, as it refuses the other cloud
 * mistakes. A loopback host (`localhost`, `127.0.0.1`, `[::1]`) may use `http:`: that traffic
 * never leaves the machine, and it is how a local key server is reached (B-420, F-dom-infra-2).
 */

import { describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { CLIENT_ID } from "./helpers/key-server.js";

const PUBLIC_CLOUD = {
  loginEndpoint: "https://login.microsoftonline.com",
  tokenIssuer: "https://api.botframework.com",
  openIdMetadataUrl: "https://login.botframework.com/v1/.well-known/openidconfiguration",
};

describe("a cloud endpoint's scheme", () => {
  it.each([
    ["loginEndpoint", "http://login.microsoftonline.com"],
    ["tokenIssuer", "http://api.botframework.com"],
    ["openIdMetadataUrl", "http://login.botframework.com/v1/.well-known/openidconfiguration"],
    ["loginEndpoint", "ftp://login.microsoftonline.com"],
    ["loginEndpoint", "login.microsoftonline.com"],
  ])("refuses %s %s at construction with a TypeError naming the field", (field, value) => {
    const build = () =>
      teamsActivityVerifier({ clientId: CLIENT_ID, cloud: { ...PUBLIC_CLOUD, [field]: value } });

    expect(build).toThrow(TypeError);
    expect(build).toThrow(`cloud.${field} must be an https: URL`);
  });

  it.each([
    "http://127.0.0.1:8080",
    "http://localhost:8080",
    "http://[::1]:8080",
  ])("accepts the loopback endpoint %s over http", (origin) => {
    const cloud = {
      loginEndpoint: origin,
      tokenIssuer: "https://api.botframework.com",
      openIdMetadataUrl: `${origin}/openidconfiguration`,
    };

    expect(() => teamsActivityVerifier({ clientId: CLIENT_ID, cloud })).not.toThrow();
  });
});
