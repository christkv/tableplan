import { describe, expect, it } from "vitest";
import { displayIngredientLine } from "./domain";

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
