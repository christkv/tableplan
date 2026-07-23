import { describe, expect, it } from "vitest";
import { displayIngredientLine, plannedServings, readMealPlanSelection } from "./domain";

const ingredient = {
  rawLine: "1 lb carrots, chopped",
  ingredient: "carrots",
  quantityMin: "1",
  quantityMax: null,
  unitId: "lb",
  preparation: "chopped",
};

describe("ingredient display", () => {
  it("preserves the source line when no scaling or conversion is requested", () => {
    expect(displayIngredientLine(ingredient, "original")).toBe(ingredient.rawLine);
  });

  it("converts and scales quantities for the measurement preference", () => {
    expect(displayIngredientLine(ingredient, "metric", 2)).toBe("907.18 g carrots, chopped");
  });
});

describe("meal-plan selection", () => {
  it("normalizes a valid selection to its ISO week", () => {
    const params = new URLSearchParams("planWeek=2026-07-15&planDate=2026-07-17&planSlot=second-breakfast");
    expect(readMealPlanSelection(params)).toEqual({
      week: "2026-07-13",
      date: "2026-07-17",
      slot: "second-breakfast",
    });
  });

  it("rejects selections outside the week or with an invalid slot", () => {
    expect(readMealPlanSelection(new URLSearchParams("planWeek=2026-07-13&planDate=2026-07-20&planSlot=dinner"))).toBeNull();
    expect(readMealPlanSelection(new URLSearchParams("planWeek=2026-07-13&planDate=2026-07-17&planSlot=not a slot"))).toBeNull();
  });
});

describe("planned servings", () => {
  it("keeps plan defaults within the API range", () => {
    expect(plannedServings(6)).toBe(6);
    expect(plannedServings(180)).toBe(100);
    expect(plannedServings(3.3)).toBe(3.25);
    expect(plannedServings(0)).toBe(4);
  });
});
