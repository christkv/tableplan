import { describe, expect, it } from "vitest";

import { parseMeasurementSystem } from "./preferences";

describe("measurement preferences", () => {
  it.each(["original", "metric", "us"] as const)("accepts %s", (value) => {
    expect(parseMeasurementSystem(value)).toBe(value);
  });

  it("rejects unknown values", () => {
    expect(() => parseMeasurementSystem("imperial")).toThrow("original, metric, or US");
  });
});
