import { formatQuantity } from "./format";
import type { MeasurementSystem, QuantityRange, UnitDefinition } from "./types";
import { convertQuantity, findUnit, preferredUnit } from "./units";

export function displayQuantity(quantity: QuantityRange, unit: UnitDefinition, system: MeasurementSystem): { quantity: QuantityRange; unit: UnitDefinition } {
  if (system === "original" || unit.toBase === null) return { quantity, unit };
  const baseValue = quantity.min * unit.toBase;
  const target = preferredUnit(baseValue, unit.dimension, system);
  if (!target) return { quantity, unit };
  return {
    quantity: {
      min: convertQuantity(quantity.min, unit, target),
      ...(quantity.max === undefined ? {} : { max: convertQuantity(quantity.max, unit, target) }),
    },
    unit: target,
  };
}

export function displayIngredientLine(input: {
  rawLine: string;
  ingredient: string;
  quantityMin: string | null;
  quantityMax: string | null;
  unitId: string | null;
  preparation: string | null;
}, system: MeasurementSystem): string {
  if (system === "original" || input.quantityMin === null || !input.unitId) return input.rawLine;
  const unit = findUnit(input.unitId);
  if (!unit) return input.rawLine;
  const displayed = displayQuantity({
    min: Number(input.quantityMin),
    ...(input.quantityMax === null ? {} : { max: Number(input.quantityMax) }),
  }, unit, system);
  const preparation = input.preparation ? `, ${input.preparation}` : "";
  return `${formatQuantity(displayed.quantity)} ${displayed.unit.symbol} ${input.ingredient}${preparation}`.trim();
}
