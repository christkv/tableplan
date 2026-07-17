import type { ParsedIngredientLine, QuantityRange } from "./types";
import { findUnit } from "./units";

const unicodeFractions: Record<string, number> = {
  "¼": 1 / 4,
  "½": 1 / 2,
  "¾": 3 / 4,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 1 / 8,
  "⅜": 3 / 8,
  "⅝": 5 / 8,
  "⅞": 7 / 8,
};

export function parseNumber(input: string): number | undefined {
  const value = input.trim();
  if (!value) return undefined;
  if (unicodeFractions[value] !== undefined) return unicodeFractions[value];
  const mixedUnicode = value.match(/^(\d+)([¼½¾⅓⅔⅛⅜⅝⅞])$/);
  if (mixedUnicode) return Number(mixedUnicode[1]) + unicodeFractions[mixedUnicode[2]];
  const mixed = value.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed && Number(mixed[3]) !== 0) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = value.match(/^(\d+)\/(\d+)$/);
  if (fraction && Number(fraction[2]) !== 0) return Number(fraction[1]) / Number(fraction[2]);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function parseQuantity(input: string): QuantityRange | undefined {
  const normalized = input.trim().replace(/[–—]/g, "-");
  const range = normalized.match(/^(.+?)\s*(?:-|\bto\b)\s*(.+)$/i);
  if (range) {
    const min = parseNumber(range[1]);
    const max = parseNumber(range[2]);
    if (min !== undefined && max !== undefined) return { min, max };
  }
  const value = parseNumber(normalized);
  return value === undefined ? undefined : { min: value };
}

const quantityToken = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|\d*[¼½¾⅓⅔⅛⅜⅝⅞])`;
const linePattern = new RegExp(String.raw`^\s*(${quantityToken}(?:\s*(?:-|–|—|to)\s*${quantityToken})?)\s+(.+)$`, "i");

export function parseIngredientLine(raw: string): ParsedIngredientLine {
  const line = raw.trim();
  if (!line) return { raw, ingredient: "", status: "unresolved" };

  const match = line.match(linePattern);
  if (!match) {
    return { raw, ingredient: line, status: "unresolved" };
  }

  const quantity = parseQuantity(match[1]);
  let remainder = match[2].trim();
  const unitCandidates = [...remainder.matchAll(/^([^\s,]+(?:\s+[^\s,]+){0,1})\s+(.+)$/g)];
  let parsedUnit;
  let ingredient = remainder;

  if (unitCandidates[0]) {
    const candidate = unitCandidates[0][1];
    parsedUnit = findUnit(candidate);
    if (!parsedUnit) {
      const first = candidate.split(/\s+/)[0];
      parsedUnit = findUnit(first);
      if (parsedUnit) ingredient = remainder.slice(first.length).trim();
    } else {
      ingredient = unitCandidates[0][2].trim();
    }
  }

  const comma = ingredient.indexOf(",");
  const preparation = comma >= 0 ? ingredient.slice(comma + 1).trim() : undefined;
  if (comma >= 0) ingredient = ingredient.slice(0, comma).trim();

  return {
    raw,
    quantity,
    unit: parsedUnit,
    ingredient,
    preparation,
    status: quantity ? (parsedUnit ? "parsed" : "partial") : "unresolved",
  };
}
