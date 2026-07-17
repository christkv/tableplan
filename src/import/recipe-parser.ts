import { parseIngredientLine } from "../domain/quantity/parse";
import { decodeSourceText, normalizeIngredientName, normalizeTag, parseServings, stableId } from "./normalize";
import { parseStringList } from "./list-parser";

export interface CsvRecipeRow {
  id: string;
  name: string;
  description: string;
  ingredients: string;
  ingredients_raw: string;
  steps: string;
  servings: string;
  serving_size: string;
  tags: string;
}

export interface ImportIssueDraft {
  field: string;
  severity: "info" | "warning" | "error";
  reasonCode: string;
  rawExcerpt: string;
}

export interface ParsedRecipeRow {
  id: string;
  sourceId: string;
  name: string;
  description: string;
  servings: number | null;
  servingSize: string | null;
  qualityFlags: string[];
  cleanedIngredients: string[];
  ingredients: Array<{
    id: string;
    position: number;
    rawLine: string;
    ingredientName: string;
    canonicalName: string;
    canonicalId: string | null;
    quantityMin: string | null;
    quantityMax: string | null;
    unitId: string | null;
    preparation: string | null;
    parseStatus: "parsed" | "partial" | "unresolved";
    parseConfidence: number;
  }>;
  steps: Array<{ id: string; position: number; instruction: string; parseStatus: string }>;
  tags: Array<{ id: string; name: string }>;
  issues: ImportIssueDraft[];
}

const excerpt = (value: string) => value.slice(0, 500);

export function parseRecipeRow(row: CsvRecipeRow): ParsedRecipeRow {
  const issues: ImportIssueDraft[] = [];
  const cleaned = parseStringList(row.ingredients);
  const rawIngredients = parseStringList(row.ingredients_raw);
  const steps = parseStringList(row.steps);
  const tags = parseStringList(row.tags);
  const servings = parseServings(row.servings);

  for (const [field, result, raw] of [
    ["ingredients", cleaned, row.ingredients],
    ["ingredients_raw", rawIngredients, row.ingredients_raw],
    ["steps", steps, row.steps],
    ["tags", tags, row.tags],
  ] as const) {
    if (result.status !== "strict") {
      issues.push({
        field,
        severity: result.status === "failed" ? "error" : "warning",
        reasonCode: result.reason ?? "repaired_json_array",
        rawExcerpt: excerpt(raw),
      });
    }
  }
  for (const flag of servings.flags) {
    issues.push({ field: "servings", severity: "warning", reasonCode: flag, rawExcerpt: excerpt(row.servings) });
  }

  const sourceId = row.id.trim();
  const recipeId = `recipe_${sourceId}`;
  const decodedCleanedIngredients = cleaned.values.map(decodeSourceText);
  const decodedRawIngredients = rawIngredients.values.map(decodeSourceText);
  const decodedSteps = steps.values.map(decodeSourceText);
  const decodedTags = tags.values.map(decodeSourceText);

  const parsedIngredients = decodedRawIngredients.map((rawLine, position) => {
    const parsed = parseIngredientLine(rawLine);
    const canonicalName = normalizeIngredientName(parsed.ingredient);
    const canonicalId = canonicalName ? stableId("ingredient", canonicalName) : null;
    if (parsed.status !== "parsed") {
      issues.push({
        field: "ingredients_raw",
        severity: parsed.status === "unresolved" ? "warning" : "info",
        reasonCode: `ingredient_${parsed.status}`,
        rawExcerpt: excerpt(rawLine),
      });
    }
    return {
      id: `${recipeId}_ingredient_${position}`,
      position,
      rawLine,
      ingredientName: parsed.ingredient || rawLine.trim(),
      canonicalName,
      canonicalId,
      quantityMin: parsed.quantity ? String(parsed.quantity.min) : null,
      quantityMax: parsed.quantity?.max === undefined ? null : String(parsed.quantity.max),
      unitId: parsed.unit?.id ?? null,
      preparation: parsed.preparation ?? null,
      parseStatus: parsed.status,
      parseConfidence: parsed.status === "parsed" ? 1 : parsed.status === "partial" ? 0.55 : 0,
    };
  });

  const normalizedTags = [...new Set(decodedTags.map(normalizeTag).filter(Boolean))];
  const qualityFlags = [...servings.flags];
  if (steps.status !== "strict") qualityFlags.push("steps_repaired");
  if (rawIngredients.status === "failed") qualityFlags.push("ingredients_unavailable");

  return {
    id: recipeId,
    sourceId,
    name: decodeSourceText(row.name).trim() || `Recipe ${sourceId}`,
    description: decodeSourceText(row.description).trim(),
    servings: servings.value,
    servingSize: decodeSourceText(row.serving_size).trim() || null,
    qualityFlags,
    cleanedIngredients: decodedCleanedIngredients,
    ingredients: parsedIngredients,
    steps: decodedSteps.map((instruction, position) => ({
      id: `${recipeId}_step_${position}`,
      position,
      instruction: instruction.trim(),
      parseStatus: steps.status === "strict" ? "parsed" : "repaired",
    })),
    tags: normalizedTags.map((name) => ({ id: stableId("tag", name), name })),
    issues,
  };
}
