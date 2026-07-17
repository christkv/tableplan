import { describe, expect, it } from "vitest";

import { parsePlannedServings, shiftPlannedDate } from "./planning";

describe("meal plan week copying", () => {
  it("preserves each weekday when copying to a later week", () => {
    expect(shiftPlannedDate("2026-07-13", "2026-07-13", "2026-07-20")).toBe("2026-07-20");
    expect(shiftPlannedDate("2026-07-19", "2026-07-13", "2026-07-20")).toBe("2026-07-26");
  });

  it("supports copying across a year boundary", () => {
    expect(shiftPlannedDate("2025-12-31", "2025-12-29", "2026-01-05")).toBe("2026-01-07");
  });

  it("rejects source items outside the source week", () => {
    expect(() => shiftPlannedDate("2026-07-20", "2026-07-13", "2026-07-20")).toThrow("outside the source week");
  });
});

describe("meal plan servings", () => {
  it("accepts fractional family servings", () => {
    expect(parsePlannedServings("2.5")).toBe(2.5);
    expect(parsePlannedServings(0.25)).toBe(0.25);
  });

  it("rejects invalid and excessive values", () => {
    expect(() => parsePlannedServings(0)).toThrow("between");
    expect(() => parsePlannedServings(101)).toThrow("between");
    expect(() => parsePlannedServings("many")).toThrow("between");
  });
});
