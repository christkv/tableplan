import { describe, expect, it } from "vitest";

import { displayIngredientLine, displayQuantity, resolveServingScale, scaleStoredQuantity } from "./display";
import { findUnit } from "./units";

describe("measurement display", () => {
  it("converts recipe mass to metric", () => {
    expect(displayIngredientLine({ rawLine: "1 lb chicken", ingredient: "chicken", quantityMin: "1", quantityMax: null, unitId: "lb", preparation: null }, "metric"))
      .toBe("453.59 g chicken");
  });

  it("preserves original and unresolved lines", () => {
    const input = { rawLine: "1 large onion", ingredient: "onion", quantityMin: null, quantityMax: null, unitId: null, preparation: null };
    expect(displayIngredientLine(input, "metric")).toBe("1 large onion");
    expect(displayIngredientLine({ ...input, quantityMin: "1", unitId: "lb" }, "original")).toBe("1 large onion");
  });

  it("selects a readable US unit from a normalized base quantity", () => {
    const result = displayQuantity({ min: 1000 }, findUnit("g")!, "us");
    expect(result.unit.id).toBe("lb");
    expect(result.quantity.min).toBeCloseTo(2.20462);
  });

  it("scales quantities and ranges before measurement conversion", () => {
    expect(displayIngredientLine({ rawLine: "1 lb chicken", ingredient: "chicken", quantityMin: "1", quantityMax: null, unitId: "lb", preparation: null }, "metric", 2))
      .toBe("907.18 g chicken");
    expect(displayIngredientLine({ rawLine: "1-2 cups stock", ingredient: "stock", quantityMin: "1", quantityMax: "2", unitId: "cup", preparation: null }, "original", 1.5))
      .toBe("1 1/2-3 cups stock");
    expect(displayIngredientLine({ rawLine: "3 cloves garlic", ingredient: "garlic", quantityMin: "3", quantityMax: null, unitId: "clove", preparation: "minced" }, "original", 2))
      .toBe("6 cloves garlic, minced");
  });

  it("scales unitless parsed quantities while preserving unresolved lines", () => {
    expect(displayIngredientLine({ rawLine: "2 eggs", ingredient: "eggs", quantityMin: "2", quantityMax: null, unitId: null, preparation: null }, "original", 2))
      .toBe("4 eggs");
    expect(displayIngredientLine({ rawLine: "salt to taste", ingredient: "salt", quantityMin: null, quantityMax: null, unitId: null, preparation: null }, "metric", 2))
      .toBe("salt to taste");
  });

  it("resolves a bounded serving ratio and falls back to the original", () => {
    expect(resolveServingScale(4, "6")).toEqual({ servings: 6, scale: 1.5 });
    expect(resolveServingScale(4, "invalid")).toEqual({ servings: 4, scale: 1 });
    expect(resolveServingScale(null, "6")).toEqual({ servings: null, scale: 1 });
  });

  it("provides scaled stored quantities for API clients", () => {
    expect(scaleStoredQuantity({ quantityMin: "1", quantityMax: "2", ingredient: "stock" }, 1.5)).toEqual({ quantityMin: "1.5", quantityMax: "3", ingredient: "stock" });
    const unresolved = { quantityMin: null, quantityMax: null, ingredient: "salt" };
    expect(scaleStoredQuantity(unresolved, 2)).toBe(unresolved);
  });
});
