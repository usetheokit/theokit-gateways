import { describe, expect, it } from "vitest";
import { channelConfigReaders } from "../../src/channel/channel-config-readers.js";
import { GatewayConfigurationError } from "../../src/errors/config-error.js";

const r = channelConfigReaders("gateway-x");

function thrown(fn: () => unknown): GatewayConfigurationError {
  try {
    fn();
  } catch (error) {
    return error as GatewayConfigurationError;
  }
  throw new Error("did not throw");
}

describe("channelConfigReaders", () => {
  it("builds invalid_config errors with the prefix", () => {
    const error = r.invalid("token", "a string");
    expect(error).toBeInstanceOf(GatewayConfigurationError);
    expect(error.code).toBe("invalid_config");
    expect(error.detail).toBe("token");
    expect(error.message).toBe("gateway-x: config.token must be a string");
  });

  it("treats undefined, null and empty string as absent", () => {
    expect([undefined, null, ""].map(r.isAbsent)).toEqual([true, true, true]);
    expect([0, false, "a"].map(r.isAbsent)).toEqual([false, false, false]);
  });

  it("readString", () => {
    expect(r.readString({}, "k")).toBeUndefined();
    expect(r.readString({ k: "" }, "k")).toBeUndefined();
    expect(r.readString({ k: "v" }, "k")).toBe("v");
    const error = thrown(() => r.readString({ k: 1 }, "k"));
    expect(error.code).toBe("invalid_config");
    expect(error.message).toBe("gateway-x: config.k must be a string");
  });

  it("requiredString", () => {
    expect(r.requiredString({ k: "v" }, "k")).toBe("v");
    for (const config of [{}, { k: "" }, { k: 1 }]) {
      const error = thrown(() => r.requiredString(config, "k"));
      expect(error.code).toBe("invalid_config");
      expect(error.detail).toBe("k");
      expect(error.message).toContain("gateway-x: config.k must be");
    }
  });

  it("readBoolean", () => {
    expect(r.readBoolean({}, "k")).toBeUndefined();
    expect(r.readBoolean({ k: "" }, "k")).toBeUndefined();
    expect(r.readBoolean({ k: false }, "k")).toBe(false);
    expect(thrown(() => r.readBoolean({ k: "yes" }, "k")).message).toBe(
      "gateway-x: config.k must be a boolean",
    );
  });

  it("readNumber", () => {
    expect(r.readNumber({}, "k")).toBeUndefined();
    expect(r.readNumber({ k: 5 }, "k")).toBe(5);
    expect(r.readNumber({ k: "6697" }, "k")).toBe(6697);
    for (const bad of ["1.5", "-1", "x", Number.NaN, true]) {
      expect(thrown(() => r.readNumber({ k: bad }, "k")).message).toBe(
        "gateway-x: config.k must be a number or a digit string",
      );
    }
  });

  it("readBooleanString", () => {
    expect(r.readBooleanString({}, "k")).toBeUndefined();
    expect(r.readBooleanString({ k: false }, "k")).toBe(false);
    expect(r.readBooleanString({ k: "true" }, "k")).toBe(true);
    expect(r.readBooleanString({ k: "false" }, "k")).toBe(false);
    expect(thrown(() => r.readBooleanString({ k: "yes" }, "k")).message).toBe(
      'gateway-x: config.k must be a boolean or "true"/"false"',
    );
  });

  it("readList", () => {
    expect(r.readList({}, "k")).toBeUndefined();
    expect(r.readList({ k: ["a", "b"] }, "k")).toEqual(["a", "b"]);
    expect(r.readList({ k: " a, b ,,c " }, "k")).toEqual(["a", "b", "c"]);
    for (const bad of [5, [1], {}]) {
      expect(thrown(() => r.readList({ k: bad }, "k")).message).toBe(
        "gateway-x: config.k must be an array of strings or a comma-separated string",
      );
    }
  });

  it("readFunction", () => {
    const fn = () => 1;
    expect(r.readFunction({}, "k")).toBeUndefined();
    expect(r.readFunction({ k: "" }, "k")).toBeUndefined();
    expect(r.readFunction({ k: fn }, "k")).toBe(fn);
    expect(thrown(() => r.readFunction({ k: "x" }, "k")).message).toBe(
      "gateway-x: config.k must be a function",
    );
  });

  it("throws the error the caller supplies", () => {
    class Mine extends GatewayConfigurationError {}
    const mine = channelConfigReaders("p", (o) => new Mine("p", o));
    expect(thrown(() => mine.requiredString({}, "k"))).toBeInstanceOf(Mine);
  });
});
