import type { AggregatedIngredient, AggregationInput, QuantityRange, UnitDefinition } from "./types";
import { convertQuantity, findUnit, preferredUnit } from "./units";

function scaleRange(quantity: QuantityRange, scale: number): QuantityRange {
  return {
    min: quantity.min * scale,
    ...(quantity.max === undefined ? {} : { max: quantity.max * scale }),
  };
}

function addRange(left: QuantityRange, right: QuantityRange): QuantityRange {
  return {
    min: left.min + right.min,
    ...(left.max === undefined && right.max === undefined
      ? {}
      : { max: (left.max ?? left.min) + (right.max ?? right.min) }),
  };
}

function normalizeToBase(quantity: QuantityRange, unit: UnitDefinition): QuantityRange {
  if (unit.toBase === null) return quantity;
  return {
    min: quantity.min * unit.toBase,
    ...(quantity.max === undefined ? {} : { max: quantity.max * unit.toBase }),
  };
}

function keyFor(input: AggregationInput): string {
  if (!input.canonicalIngredientId || !input.quantity || !input.unit || input.unit.toBase === null) {
    return `unresolved:${input.source.recipeId}:${input.raw}`;
  }
  return [input.canonicalIngredientId, input.unit.dimension, input.preparation?.toLowerCase() ?? ""].join(":");
}

export function aggregateIngredients(inputs: AggregationInput[]): AggregatedIngredient[] {
  const groups = new Map<string, AggregatedIngredient>();
  for (const input of inputs) {
    const key = keyFor(input);
    const safelyConvertible = Boolean(input.canonicalIngredientId && input.quantity && input.unit?.toBase !== null);
    const scaled = input.quantity ? scaleRange(input.quantity, input.scale) : undefined;
    const normalized = safelyConvertible && scaled && input.unit ? normalizeToBase(scaled, input.unit) : scaled;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        canonicalIngredientId: input.canonicalIngredientId,
        name: input.ingredient,
        quantity: normalized,
        unit: safelyConvertible && input.unit
          ? (input.unit.dimension === "mass" ? findUnit("g") : input.unit.dimension === "volume" ? findUnit("ml") : input.unit.dimension === "count" ? findUnit("each") : input.unit)
          : input.unit,
        preparation: input.preparation,
        unresolved: !safelyConvertible,
        sources: [input.source],
      });
      continue;
    }
    if (existing.quantity && normalized) existing.quantity = addRange(existing.quantity, normalized);
    existing.sources.push(input.source);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function displayAggregate(item: AggregatedIngredient, system: "original" | "us" | "metric"): AggregatedIngredient {
  if (!item.quantity || !item.unit || item.unit.toBase === null || system === "original") return item;
  const target = preferredUnit(item.quantity.min, item.unit.dimension, system);
  if (!target) return item;
  return {
    ...item,
    quantity: {
      min: convertQuantity(item.quantity.min, item.unit, target),
      ...(item.quantity.max === undefined ? {} : { max: convertQuantity(item.quantity.max, item.unit, target) }),
    },
    unit: target,
  };
}
