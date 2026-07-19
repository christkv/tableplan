import { getMealPlanById } from "../db/planning";
import { getMealPlanSlots } from "../db/preferences";
import { getRecipe } from "../db/recipes";
import { getShoppingListById, getShoppingListForPlan } from "../db/shopping";
import { displayIngredientLine, resolveServingScale } from "../domain/quantity/display";
import { formatNumber } from "../domain/quantity/format";
import type { MeasurementSystem } from "../domain/quantity/types";
import type { RecipeAccessContext } from "../domain/recipes";

export interface ExportOptions {
  paper: "a4" | "letter";
  measurementSystem: MeasurementSystem;
  servings?: number;
  includeSourceRecipes: boolean;
  includeCheckedItems: boolean;
}

export interface RecipeExportModel {
  kind: "recipe";
  title: string;
  description: string;
  servings: number | null;
  servingSize: string | null;
  measurementSystem: MeasurementSystem;
  tags: string[];
  ingredients: Array<{ text: string; unresolved: boolean }>;
  steps: string[];
}

export interface MealPlanExportModel {
  kind: "meal-plan";
  id: string;
  title: string;
  startsOn: string;
  endsOn: string;
  slots: Array<{ id: string; label: string }>;
  days: Array<{ date: string; label: string; meals: Array<{ slotId: string; recipeName: string; servings: number; notes: string | null }> }>;
}

export interface ShoppingListExportModel {
  kind: "shopping-list";
  id: string;
  title: string;
  startsOn: string | null;
  endsOn: string | null;
  measurementSystem: MeasurementSystem;
  items: Array<{ name: string; quantity: string; checked: boolean; unresolved: boolean; sources: string[] }>;
}

export interface CombinedExportModel {
  kind: "combined";
  plan: MealPlanExportModel;
  shoppingList: ShoppingListExportModel;
}

export function parseExportOptions(searchParams: URLSearchParams, defaults: { measurementSystem: MeasurementSystem; servings?: number | null }): ExportOptions {
  const paper = searchParams.get("paper")?.toLowerCase() === "letter" ? "letter" : "a4";
  const requestedSystem = searchParams.get("measurementSystem");
  const measurementSystem: MeasurementSystem = requestedSystem === "metric" || requestedSystem === "us" || requestedSystem === "original"
    ? requestedSystem : defaults.measurementSystem;
  const requestedServings = Number(searchParams.get("servings") ?? defaults.servings);
  const servings = Number.isFinite(requestedServings) && requestedServings >= 0.25 && requestedServings <= 1_000 ? requestedServings : undefined;
  return {
    paper,
    measurementSystem,
    ...(servings === undefined ? {} : { servings }),
    includeSourceRecipes: searchParams.get("includeSourceRecipes") !== "false",
    includeCheckedItems: searchParams.get("includeCheckedItems") !== "false",
  };
}

export function safeExportFilename(value: string): string {
  const safe = value.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 80);
  return safe || "tableplan-export";
}

export async function buildRecipeExport(db: D1Database, recipeId: string, access: RecipeAccessContext, options: ExportOptions): Promise<RecipeExportModel | null> {
  const recipe = await getRecipe(db, recipeId, access);
  if (!recipe) return null;
  const serving = resolveServingScale(recipe.servings, options.servings);
  return {
    kind: "recipe",
    title: recipe.name,
    description: recipe.description,
    servings: serving.servings,
    servingSize: recipe.servingSize,
    measurementSystem: options.measurementSystem,
    tags: recipe.tags,
    ingredients: recipe.recipeIngredients.map((item) => ({
      text: displayIngredientLine(item, options.measurementSystem, serving.scale),
      unresolved: item.parseStatus !== "parsed",
    })),
    steps: recipe.steps.map((step) => step.instruction),
  };
}

const addUtcDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

export async function buildMealPlanExport(db: D1Database, householdId: string, planId: string): Promise<MealPlanExportModel | null> {
  const [plan, configuredSlots] = await Promise.all([getMealPlanById(db, householdId, planId), getMealPlanSlots(db, householdId)]);
  if (!plan) return null;
  const slotIds = new Set(configuredSlots.map((slot) => slot.id));
  const legacy = [...new Set(plan.items.map((item) => item.mealSlot))].filter((slot) => !slotIds.has(slot))
    .map((id) => ({ id, label: id.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) }));
  const slots = [...configuredSlots, ...legacy];
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addUtcDays(plan.startsOn, index);
    return {
      date,
      label: new Intl.DateTimeFormat("en", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)),
      meals: plan.items.filter((item) => item.plannedDate === date).map((item) => ({ slotId: item.mealSlot, recipeName: item.recipeName, servings: item.servings, notes: item.notes })),
    };
  });
  return { kind: "meal-plan", id: plan.id, title: plan.name, startsOn: plan.startsOn, endsOn: plan.endsOn, slots, days };
}

const quantityText = (min: string | null, max: string | null, unit: string | null) => min === null
  ? "" : `${formatNumber(Number(min))}${max === null ? "" : `-${formatNumber(Number(max))}`} ${unit ?? ""}`.trim();

export async function buildShoppingListExport(db: D1Database, householdId: string, listId: string, options: ExportOptions): Promise<ShoppingListExportModel | null> {
  const list = await getShoppingListById(db, householdId, listId, options.measurementSystem);
  if (!list) return null;
  return {
    kind: "shopping-list",
    id: list.id,
    title: list.name,
    startsOn: list.plan?.startsOn ?? null,
    endsOn: list.plan?.endsOn ?? null,
    measurementSystem: list.measurementSystem,
    items: list.items.filter((item) => options.includeCheckedItems || !item.checked).map((item) => ({
      name: item.name,
      quantity: quantityText(item.quantityMin, item.quantityMax, item.unitId),
      checked: item.checked,
      unresolved: item.unresolved,
      sources: options.includeSourceRecipes ? [...new Set(item.sources.map((source) => source.recipeName))] : [],
    })),
  };
}

export async function buildCombinedExport(db: D1Database, householdId: string, planId: string, listId: string | undefined, options: ExportOptions): Promise<CombinedExportModel | null> {
  const [plan, list] = await Promise.all([
    buildMealPlanExport(db, householdId, planId),
    getShoppingListForPlan(db, householdId, planId, listId, options.measurementSystem),
  ]);
  if (!plan || !list) return null;
  const shoppingList = await buildShoppingListExport(db, householdId, list.id, options);
  return shoppingList ? { kind: "combined", plan, shoppingList } : null;
}
