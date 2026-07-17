import { describe, expect, it } from "vitest";

import { shiftPlannedDate } from "./planning";

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
