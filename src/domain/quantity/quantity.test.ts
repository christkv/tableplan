import { describe, expect, it } from "vitest";

import { aggregateIngredients, displayAggregate } from "./aggregate";
import { formatNumber, formatQuantity } from "./format";
import { parseIngredientLine, parseNumber, parseQuantity } from "./parse";
import { convertQuantity, findUnit } from "./units";

describe("quantity parsing", () => {
  it.each([
    ["2", 2],
    ["1/2", 0.5],
    ["1 1/2", 1.5],
    ["½", 0.5],
    ["2½", 2.5],
  ])("parses %s", (input, expected) => {
    expect(parseNumber(input)).toBeCloseTo(expected);
  });

  it("parses ranges without collapsing them", () => {
    expect(parseQuantity("1 1/2-2")).toEqual({ min: 1.5, max: 2 });
  });

  it("parses a unit and preparation", () => {
    const result = parseIngredientLine("2 tbsp olive oil, divided");
    expect(result).toMatchObject({
      quantity: { min: 2 },
      ingredient: "olive oil",
      preparation: "divided",
      status: "parsed",
    });
    expect(result.unit?.id).toBe("tbsp");
  });

  it("preserves unresolved ingredient lines", () => {
    expect(parseIngredientLine("salt to taste")).toEqual({
      raw: "salt to taste",
      ingredient: "salt to taste",
      status: "unresolved",
    });
  });
});

describe("unit conversion", () => {
  it("converts pounds to grams", () => {
    expect(convertQuantity(1, findUnit("lb")!, findUnit("g")!)).toBeCloseTo(453.59237);
  });

  it("rejects cross-dimension conversions", () => {
    expect(() => convertQuantity(1, findUnit("cup")!, findUnit("g")!)).toThrow(/Cannot convert/);
  });

  it("rejects incompatible package conversions", () => {
    expect(() => convertQuantity(1, findUnit("can")!, findUnit("bag")!)).toThrow(/not convertible/);
  });
});

describe("aggregation", () => {
  it("scales and merges compatible mass quantities", () => {
    const gram = findUnit("g")!;
    const ounce = findUnit("oz")!;
    const items = aggregateIngredients([
      {
        raw: "100 g flour",
        quantity: { min: 100 },
        unit: gram,
        ingredient: "flour",
        status: "parsed",
        canonicalIngredientId: "flour",
        scale: 1.5,
        source: { recipeId: "a", recipeName: "A", rawLine: "100 g flour" },
      },
      {
        raw: "2 oz flour",
        quantity: { min: 2 },
        unit: ounce,
        ingredient: "flour",
        status: "parsed",
        canonicalIngredientId: "flour",
        scale: 1,
        source: { recipeId: "b", recipeName: "B", rawLine: "2 oz flour" },
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].quantity?.min).toBeCloseTo(206.69904625);
    expect(items[0].sources).toHaveLength(2);
    expect(displayAggregate(items[0], "us").unit?.id).toBe("oz");
  });

  it("does not merge unresolved package lines", () => {
    const can = findUnit("can")!;
    const base = {
      quantity: { min: 1 },
      unit: can,
      ingredient: "tomatoes",
      status: "parsed" as const,
      canonicalIngredientId: "tomato",
      scale: 1,
    };
    expect(aggregateIngredients([
      { ...base, raw: "1 can tomatoes", source: { recipeId: "a", recipeName: "A", rawLine: "1 can tomatoes" } },
      { ...base, raw: "1 can tomatoes", source: { recipeId: "b", recipeName: "B", rawLine: "1 can tomatoes" } },
    ])).toHaveLength(2);
  });
});

describe("formatting", () => {
  it("formats common fractions and ranges", () => {
    expect(formatNumber(1.5)).toBe("1 1/2");
    expect(formatQuantity({ min: 0.25, max: 0.5 })).toBe("1/4-1/2");
  });
});
