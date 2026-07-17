import { formatQuantity } from "./format";
import type { MeasurementSystem, QuantityRange, UnitDefinition } from "./types";
import { convertQuantity, findUnit, preferredUnit } from "./units";

const pluralUnitSymbols: Record<string, string> = {
  cup: "cups", clove: "cloves", slice: "slices", bunch: "bunches", pinch: "pinches",
  dash: "dashes", can: "cans", bag: "bags", box: "boxes", jar: "jars",
};

function displayUnitSymbol(unit: UnitDefinition | undefined, quantity: QuantityRange): string {
  if (!unit) return "";
  const plural = quantity.min !== 1 || (quantity.max !== undefined && quantity.max !== 1);
  return plural ? pluralUnitSymbols[unit.id] ?? unit.symbol : unit.symbol;
}

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
}, system: MeasurementSystem, scale = 1): string {
  if (input.quantityMin === null || !Number.isFinite(scale) || scale <= 0) return input.rawLine;
  const quantity = {
    min: Number(input.quantityMin) * scale,
    ...(input.quantityMax === null ? {} : { max: Number(input.quantityMax) * scale }),
  };
  const unit = input.unitId ? findUnit(input.unitId) : undefined;
  if (system === "original" && scale === 1) return input.rawLine;
  if (input.unitId && !unit) return input.rawLine;
  const displayed = unit && system !== "original" ? displayQuantity(quantity, unit, system) : { quantity, unit };
  const preparation = input.preparation ? `, ${input.preparation}` : "";
  const unitSymbol = displayUnitSymbol(displayed.unit, displayed.quantity);
  const symbol = unitSymbol ? ` ${unitSymbol}` : "";
  return `${formatQuantity(displayed.quantity)}${symbol} ${input.ingredient}${preparation}`.trim();
}

export function resolveServingScale(originalServings: number | null, requested: unknown): { servings: number | null; scale: number } {
  if (!originalServings || !Number.isFinite(originalServings) || originalServings <= 0) return { servings: originalServings, scale: 1 };
  const parsed = typeof requested === "number" ? requested : Number(requested);
  const servings = Number.isFinite(parsed) && parsed >= 0.25 && parsed <= 1_000 ? parsed : originalServings;
  return { servings, scale: servings / originalServings };
}

export function scaleStoredQuantity<T extends { quantityMin: string | null; quantityMax: string | null }>(input: T, scale: number): T {
  if (input.quantityMin === null || !Number.isFinite(scale) || scale <= 0 || scale === 1) return input;
  return {
    ...input,
    quantityMin: String(Number(input.quantityMin) * scale),
    quantityMax: input.quantityMax === null ? null : String(Number(input.quantityMax) * scale),
  };
}
