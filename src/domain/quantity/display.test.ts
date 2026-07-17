import { describe, expect, it } from "vitest";

import { displayIngredientLine, displayQuantity } from "./display";
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
});
