import type { MeasurementSystem, UnitDefinition, UnitDimension } from "./types";

const unit = (
  id: string,
  name: string,
  symbol: string,
  dimension: UnitDimension,
  system: UnitDefinition["system"],
  toBase: number | null,
  aliases: string[],
): UnitDefinition => ({ id, name, symbol, dimension, system, toBase, aliases });

export const UNITS = [
  unit("g", "gram", "g", "mass", "metric", 1, ["g", "gram", "grams"]),
  unit("kg", "kilogram", "kg", "mass", "metric", 1000, ["kg", "kilogram", "kilograms"]),
  unit("oz", "ounce", "oz", "mass", "us", 28.349523125, ["oz", "ounce", "ounces"]),
  unit("lb", "pound", "lb", "mass", "us", 453.59237, ["lb", "lbs", "pound", "pounds"]),
  unit("ml", "milliliter", "ml", "volume", "metric", 1, ["ml", "milliliter", "milliliters", "millilitre", "millilitres"]),
  unit("l", "liter", "L", "volume", "metric", 1000, ["l", "liter", "liters", "litre", "litres"]),
  unit("tsp", "teaspoon", "tsp", "volume", "us", 4.92892159375, ["tsp", "tsp.", "teaspoon", "teaspoons"]),
  unit("tbsp", "tablespoon", "tbsp", "volume", "us", 14.78676478125, ["tbsp", "tbsp.", "tablespoon", "tablespoons"]),
  unit("cup", "cup", "cup", "volume", "us", 236.5882365, ["c", "cup", "cups"]),
  unit("floz", "fluid ounce", "fl oz", "volume", "us", 29.5735295625, ["fl oz", "fluid ounce", "fluid ounces"]),
  unit("pint", "pint", "pt", "volume", "us", 473.176473, ["pt", "pint", "pints"]),
  unit("quart", "quart", "qt", "volume", "us", 946.352946, ["qt", "quart", "quarts"]),
  unit("gallon", "gallon", "gal", "volume", "us", 3785.411784, ["gal", "gallon", "gallons"]),
  unit("each", "each", "each", "count", "universal", 1, ["each", "item", "items"]),
  unit("clove", "clove", "clove", "count", "universal", 1, ["clove", "cloves"]),
  unit("slice", "slice", "slice", "count", "universal", 1, ["slice", "slices"]),
  unit("bunch", "bunch", "bunch", "count", "universal", 1, ["bunch", "bunches"]),
  unit("pinch", "pinch", "pinch", "count", "universal", 1, ["pinch", "pinches"]),
  unit("dash", "dash", "dash", "count", "universal", 1, ["dash", "dashes"]),
  unit("can", "can", "can", "package", "universal", null, ["can", "cans"]),
  unit("package", "package", "pkg", "package", "universal", null, ["package", "packages", "pkg", "pkge", "packet", "packets"]),
  unit("bag", "bag", "bag", "package", "universal", null, ["bag", "bags"]),
  unit("box", "box", "box", "package", "universal", null, ["box", "boxes"]),
  unit("jar", "jar", "jar", "package", "universal", null, ["jar", "jars"]),
] as const satisfies readonly UnitDefinition[];

const aliasMap = new Map<string, UnitDefinition>();
for (const definition of UNITS) {
  for (const alias of definition.aliases) {
    aliasMap.set(alias.toLowerCase(), definition);
  }
}

export function findUnit(value: string): UnitDefinition | undefined {
  return aliasMap.get(value.trim().toLowerCase());
}

export function convertQuantity(value: number, from: UnitDefinition, to: UnitDefinition): number {
  if (from.dimension !== to.dimension) {
    throw new Error(`Cannot convert ${from.dimension} to ${to.dimension}`);
  }
  if (from.toBase === null || to.toBase === null) {
    if (from.id === to.id) return value;
    throw new Error(`Unit ${from.id} or ${to.id} is not convertible`);
  }
  return (value * from.toBase) / to.toBase;
}

export function preferredUnit(baseValue: number, dimension: UnitDimension, system: MeasurementSystem): UnitDefinition | undefined {
  if (system === "original") return undefined;
  if (dimension === "mass") {
    if (system === "metric") return findUnit(baseValue >= 1000 ? "kg" : "g");
    const ounces = baseValue / 28.349523125;
    return findUnit(ounces >= 16 ? "lb" : "oz");
  }
  if (dimension === "volume") {
    if (system === "metric") return findUnit(baseValue >= 1000 ? "l" : "ml");
    if (baseValue >= 236.5882365) return findUnit("cup");
    if (baseValue >= 14.78676478125) return findUnit("tbsp");
    return findUnit("tsp");
  }
  return undefined;
}
