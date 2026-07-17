import { decodeSourceText, normalizeTag } from "../import/normalize";

import type { RecipeDraft } from "./types";

const INGREDIENT_HEADING = /^(ingredients?|what you(?:'|’)ll need)\s*:?#?$/i;
const STEP_HEADING = /^(instructions?|directions?|method|preparation|steps?)\s*:?#?$/i;
const META_LINE = /^(?:serves?|servings?|yield)\s*[:\-]?\s*(\d+(?:\.\d+)?)/i;
const BULLET = /^\s*(?:[-*•]\s+|\d+[.)]\s+)/;
const NUMBERED_STEP = /^\s*\d+[.)]\s+/;
const QUANTITY_LINE = /^\s*(?:[-*•]\s*)?(?:\d|[¼½¾⅓⅔⅛⅜⅝⅞]|one\b|two\b|three\b)/i;

function cleanLine(value: string): string {
  return decodeSourceText(value).replace(BULLET, "").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function extractRecipeFromText(source: string, fallbackTitle = "Untitled recipe"): RecipeDraft {
  const lines = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  let section: "intro" | "ingredients" | "steps" = "intro";
  const intro: string[] = [];
  const ingredients: string[] = [];
  const steps: string[] = [];
  const warnings: string[] = [];
  let servings: number | null = null;

  for (const line of lines) {
    const heading = line.replace(/^#+\s*/, "").trim();
    if (INGREDIENT_HEADING.test(heading)) { section = "ingredients"; continue; }
    if (STEP_HEADING.test(heading)) { section = "steps"; continue; }
    const servingMatch = heading.match(META_LINE);
    if (servingMatch) { servings = Number(servingMatch[1]); continue; }
    if (section === "ingredients") ingredients.push(cleanLine(line));
    else if (section === "steps") steps.push(cleanLine(line));
    else intro.push(cleanLine(line));
  }

  const title = intro.shift() || fallbackTitle.replace(/\.[^.]+$/, "").replaceAll(/[-_]+/g, " ").trim() || "Untitled recipe";
  if (!ingredients.length || !steps.length) {
    const body = intro.splice(0);
    if (!ingredients.length) {
      const inferred = body.filter((line) => QUANTITY_LINE.test(line) && !NUMBERED_STEP.test(line));
      ingredients.push(...inferred.map(cleanLine));
      for (const line of inferred) body.splice(body.indexOf(line), 1);
    }
    if (!steps.length) steps.push(...body.filter((line) => NUMBERED_STEP.test(line) || !QUANTITY_LINE.test(line)).map(cleanLine));
  }
  if (!ingredients.length) warnings.push("No ingredient lines were detected. Add them before publishing.");
  if (!steps.length) warnings.push("No instructions were detected. Add them before publishing.");

  return {
    title,
    description: intro.join(" "),
    servings,
    servingSize: null,
    ingredients: unique(ingredients),
    steps: unique(steps),
    tags: [],
    warnings,
  };
}

export function normalizeRecipeDraft(value: Partial<RecipeDraft>): RecipeDraft {
  const servings = Number(value.servings);
  return {
    title: String(value.title ?? "").trim().slice(0, 240),
    description: String(value.description ?? "").trim().slice(0, 4_000),
    servings: Number.isFinite(servings) && servings > 0 && servings <= 1_000 ? servings : null,
    servingSize: String(value.servingSize ?? "").trim().slice(0, 120) || null,
    ingredients: unique((value.ingredients ?? []).map(String)).slice(0, 250),
    steps: unique((value.steps ?? []).map(String)).slice(0, 250),
    tags: unique((value.tags ?? []).map((tag) => normalizeTag(String(tag)))).slice(0, 30),
    warnings: unique((value.warnings ?? []).map(String)).slice(0, 30),
  };
}

export const recipeDraftJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "servings", "servingSize", "ingredients", "steps", "tags", "warnings"],
  properties: {
    title: { type: "string" }, description: { type: "string" }, servings: { type: ["number", "null"] },
    servingSize: { type: ["string", "null"] }, ingredients: { type: "array", items: { type: "string" } },
    steps: { type: "array", items: { type: "string" } }, tags: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const;
