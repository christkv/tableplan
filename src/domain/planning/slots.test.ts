import { describe, expect, it } from "vitest";

import { defaultMealSlots, parseMealSlotDefinitions, readStoredMealSlots } from "./slots";

describe("custom meal sections", () => {
  it("keeps stable IDs while labels and ordering change", () => {
    expect(parseMealSlotDefinitions(["dinner", "breakfast"], ["Supper", "Early meal"]))
      .toEqual([{ id: "dinner", label: "Supper" }, { id: "breakfast", label: "Early meal" }]);
  });

  it("creates deterministic unique IDs for new sections", () => {
    expect(parseMealSlotDefinitions(["", ""], ["Afternoon tea", "Afternoon-tea"]))
      .toEqual([{ id: "afternoon-tea", label: "Afternoon tea" }, { id: "afternoon-tea-2", label: "Afternoon-tea" }]);
  });

  it("rejects blank, duplicate, and excessive definitions", () => {
    expect(() => parseMealSlotDefinitions([], [])).toThrow("At least one");
    expect(() => parseMealSlotDefinitions(["one", "two"], ["Dinner", " dinner "])).toThrow("unique");
    expect(() => parseMealSlotDefinitions(Array(9).fill(""), Array.from({ length: 9 }, (_, index) => `Meal ${index}`))).toThrow("up to 8");
  });

  it("falls back to defaults for malformed stored data", () => {
    expect(readStoredMealSlots("not-json")).toEqual(defaultMealSlots);
  });
});
