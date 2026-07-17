import { describe, expect, it } from "vitest";

import { readMealPlanSelection, withMealPlanSelection } from "./selection";

describe("meal plan recipe selection context", () => {
  it("retains a valid date and slot in its normalized ISO week", () => {
    const parameters = new URLSearchParams("planWeek=2026-07-15&planDate=2026-07-17&planSlot=second-breakfast");
    expect(readMealPlanSelection(parameters)).toEqual({ week: "2026-07-13", date: "2026-07-17", slot: "second-breakfast" });
  });

  it("rejects dates outside the selected week and unknown slots", () => {
    expect(readMealPlanSelection(new URLSearchParams("planWeek=2026-07-13&planDate=2026-07-20&planSlot=dinner"))).toBeNull();
    expect(readMealPlanSelection(new URLSearchParams("planWeek=2026-07-13&planDate=2026-07-17&planSlot=not a valid id"))).toBeNull();
    expect(readMealPlanSelection(new URLSearchParams("planWeek=2026-99-99&planDate=2026-07-17&planSlot=dinner"))).toBeNull();
  });

  it("adds context without dropping existing search parameters", () => {
    expect(withMealPlanSelection("/recipes?q=pasta", { week: "2026-07-13", date: "2026-07-17", slot: "dinner" }))
      .toBe("/recipes?q=pasta&planWeek=2026-07-13&planDate=2026-07-17&planSlot=dinner");
  });
});
