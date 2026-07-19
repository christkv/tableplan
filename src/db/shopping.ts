import { aggregateIngredients } from "../domain/quantity/aggregate";
import { displayQuantity } from "../domain/quantity/display";
import type { AggregatedIngredient, MeasurementSystem } from "../domain/quantity/types";
import { findUnit } from "../domain/quantity/units";

export interface ShoppingItemView {
  id: string; name: string; quantityMin: string | null; quantityMax: string | null; unitId: string | null;
  checked: boolean; unresolved: boolean; sources: Array<{ recipeId: string; recipeName: string; rawLine: string }>;
}

export interface ShoppingListPlanView { id: string; name: string; startsOn: string; endsOn: string; mealCount: number }
export interface ShoppingListView {
  id: string; name: string; measurementSystem: MeasurementSystem; generatedAt: string; updatedAt: string;
  plan: ShoppingListPlanView | null; items: ShoppingItemView[];
}

interface ShoppingListRow {
  id: string; name: string; measurement_system: MeasurementSystem; created_at: string; updated_at: string;
  meal_plan_id: string | null; starts_on: string | null; ends_on: string | null; plan_name: string | null; meal_count: number;
}

async function aggregatePlanIngredients(db: D1Database, input: { householdId: string; planId: string; startsOn: string; endsOn: string }): Promise<AggregatedIngredient[]> {
  const rows = await db.prepare(`
    SELECT mpi.id plan_item_id, mpi.recipe_id, r.name recipe_name, r.servings recipe_servings, mpi.servings planned_servings,
      ri.raw_line, ri.ingredient_text, ri.ingredient_id, ri.quantity_min, ri.quantity_max, ri.unit_id, ri.preparation, ri.parse_status
    FROM meal_plan_items mpi JOIN meal_plans mp ON mp.id = mpi.meal_plan_id JOIN recipes r ON r.id = mpi.recipe_id
      JOIN recipe_ingredients ri ON ri.recipe_id = r.id
    WHERE mp.id = ? AND mp.household_id = ? AND mpi.planned_date BETWEEN ? AND ? ORDER BY mpi.planned_date, mpi.id, ri.position`)
    .bind(input.planId, input.householdId, input.startsOn, input.endsOn).all<{
      recipe_id: string; recipe_name: string; recipe_servings: number | null; planned_servings: string; raw_line: string;
      ingredient_text: string; ingredient_id: string | null; quantity_min: string | null; quantity_max: string | null;
      unit_id: string | null; preparation: string | null; parse_status: "parsed" | "partial" | "unresolved";
    }>();
  return aggregateIngredients(rows.results.map((row) => ({
    raw: row.raw_line,
    quantity: row.quantity_min === null ? undefined : { min: Number(row.quantity_min), ...(row.quantity_max === null ? {} : { max: Number(row.quantity_max) }) },
    unit: row.unit_id ? findUnit(row.unit_id) : undefined,
    ingredient: row.ingredient_text,
    preparation: row.preparation ?? undefined,
    status: row.parse_status,
    canonicalIngredientId: row.ingredient_id ?? undefined,
    scale: Number(row.planned_servings) / (row.recipe_servings && row.recipe_servings > 0 ? row.recipe_servings : Number(row.planned_servings)),
    source: { recipeId: row.recipe_id, recipeName: row.recipe_name, rawLine: row.raw_line },
  })));
}

const checkedItemKey = (ingredientId: string | null | undefined, name: string, preparation: string | null | undefined) => `${ingredientId ?? ""}:${name.toLocaleLowerCase()}:${preparation?.toLocaleLowerCase() ?? ""}`;

async function replaceShoppingListItems(db: D1Database, listId: string, aggregates: AggregatedIngredient[], preserveChecks: boolean) {
  const checked = new Map<string, boolean>();
  if (preserveChecks) {
    const existing = await db.prepare("SELECT ingredient_id, display_name, preparation, checked FROM shopping_list_items WHERE shopping_list_id=?")
      .bind(listId).all<{ ingredient_id: string | null; display_name: string; preparation: string | null; checked: number }>();
    for (const item of existing.results) checked.set(checkedItemKey(item.ingredient_id, item.display_name, item.preparation), Boolean(item.checked));
  }
  const statements: D1PreparedStatement[] = [db.prepare("DELETE FROM shopping_list_items WHERE shopping_list_id=?").bind(listId)];
  aggregates.forEach((item, position) => statements.push(db.prepare(`INSERT INTO shopping_list_items
    (id, shopping_list_id, ingredient_id, display_name, quantity_min, quantity_max, base_unit_id, dimension, preparation, checked, unresolved, source_json, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), listId, item.canonicalIngredientId ?? null, item.name, item.quantity ? String(item.quantity.min) : null,
      item.quantity?.max === undefined ? null : String(item.quantity.max), item.unit?.id ?? null, item.unit?.dimension ?? null,
      item.preparation ?? null, checked.get(checkedItemKey(item.canonicalIngredientId, item.name, item.preparation)) ? 1 : 0,
      item.unresolved ? 1 : 0, JSON.stringify(item.sources), position)));
  for (let index = 0; index < statements.length; index += 80) await db.batch(statements.slice(index, index + 80));
}

export async function generateShoppingList(db: D1Database, input: { householdId: string; planId: string; startsOn: string; endsOn: string; userId: string; measurementSystem: "original" | "us" | "metric" }) {
  const plan = await db.prepare("SELECT id, name, starts_on, ends_on FROM meal_plans WHERE id=? AND household_id=?")
    .bind(input.planId, input.householdId).first<{ id: string; name: string; starts_on: string; ends_on: string }>();
  if (!plan || plan.starts_on !== input.startsOn || plan.ends_on !== input.endsOn) throw new Error("Meal plan does not match the requested week");
  const aggregates = await aggregatePlanIngredients(db, input);
  const listId = crypto.randomUUID();
  await db.prepare("INSERT INTO shopping_lists (id, household_id, meal_plan_id, name, starts_on, ends_on, measurement_system, generation_version, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'v2', ?)")
    .bind(listId, input.householdId, input.planId, `Shopping for ${plan.name}`, input.startsOn, input.endsOn, input.measurementSystem, input.userId).run();
  await replaceShoppingListItems(db, listId, aggregates, false);
  return listId;
}

export async function refreshShoppingListForPlan(db: D1Database, householdId: string, planId: string): Promise<string | null> {
  const list = await db.prepare(`SELECT sl.id, sl.starts_on, sl.ends_on FROM shopping_lists sl
    WHERE sl.household_id=? AND sl.meal_plan_id=? ORDER BY sl.created_at DESC LIMIT 1`)
    .bind(householdId, planId).first<{ id: string; starts_on: string; ends_on: string }>();
  if (!list) return null;
  const aggregates = await aggregatePlanIngredients(db, { householdId, planId, startsOn: list.starts_on, endsOn: list.ends_on });
  await replaceShoppingListItems(db, list.id, aggregates, true);
  await db.prepare("UPDATE shopping_lists SET generation_version='v2', updated_at=CURRENT_TIMESTAMP WHERE id=? AND household_id=?").bind(list.id, householdId).run();
  return list.id;
}

export async function refreshShoppingListsForRecipe(db: D1Database, householdId: string, recipeId: string) {
  const plans = await db.prepare(`SELECT DISTINCT mp.id FROM meal_plans mp JOIN meal_plan_items mpi ON mpi.meal_plan_id=mp.id
    WHERE mp.household_id=? AND mpi.recipe_id=?`).bind(householdId, recipeId).all<{ id: string }>();
  for (const plan of plans.results) await refreshShoppingListForPlan(db, householdId, plan.id);
}

export async function getLatestShoppingList(db: D1Database, householdId: string, displaySystem?: MeasurementSystem): Promise<ShoppingListView | null> {
  const list = await db.prepare(`SELECT sl.id, sl.name, sl.measurement_system, sl.created_at, sl.updated_at,
      sl.meal_plan_id, sl.starts_on, sl.ends_on, mp.name AS plan_name,
      (SELECT COUNT(*) FROM meal_plan_items mpi WHERE mpi.meal_plan_id=sl.meal_plan_id) AS meal_count
    FROM shopping_lists sl LEFT JOIN meal_plans mp ON mp.id=sl.meal_plan_id
    WHERE sl.household_id=? ORDER BY sl.created_at DESC LIMIT 1`).bind(householdId).first<ShoppingListRow>();
  if (!list) return null;
  return getShoppingListItems(db, list, displaySystem);
}

export async function getShoppingListById(db: D1Database, householdId: string, listId: string, displaySystem?: MeasurementSystem): Promise<ShoppingListView | null> {
  const list = await db.prepare(`SELECT sl.id, sl.name, sl.measurement_system, sl.created_at, sl.updated_at,
      sl.meal_plan_id, sl.starts_on, sl.ends_on, mp.name AS plan_name,
      (SELECT COUNT(*) FROM meal_plan_items mpi WHERE mpi.meal_plan_id=sl.meal_plan_id) AS meal_count
    FROM shopping_lists sl LEFT JOIN meal_plans mp ON mp.id=sl.meal_plan_id
    WHERE sl.id=? AND sl.household_id=?`).bind(listId, householdId).first<ShoppingListRow>();
  if (!list) return null;
  return getShoppingListItems(db, list, displaySystem);
}

export async function getShoppingListForPlan(db: D1Database, householdId: string, planId: string, listId?: string, displaySystem?: MeasurementSystem): Promise<ShoppingListView | null> {
  const list = await db.prepare(`SELECT sl.id, sl.name, sl.measurement_system, sl.created_at, sl.updated_at,
      sl.meal_plan_id, sl.starts_on, sl.ends_on, mp.name AS plan_name,
      (SELECT COUNT(*) FROM meal_plan_items mpi WHERE mpi.meal_plan_id=sl.meal_plan_id) AS meal_count
    FROM shopping_lists sl JOIN meal_plans mp ON mp.id=sl.meal_plan_id
    WHERE sl.household_id=? AND sl.meal_plan_id=? AND (? IS NULL OR sl.id=?)
    ORDER BY sl.created_at DESC LIMIT 1`).bind(householdId, planId, listId ?? null, listId ?? null).first<ShoppingListRow>();
  if (!list) return null;
  return getShoppingListItems(db, list, displaySystem);
}

async function getShoppingListItems(db: D1Database, list: ShoppingListRow, displaySystem?: MeasurementSystem): Promise<ShoppingListView> {
  const rows = await db.prepare("SELECT id, display_name, quantity_min, quantity_max, base_unit_id, checked, unresolved, source_json FROM shopping_list_items WHERE shopping_list_id = ? ORDER BY checked, position").bind(list.id).all<{
    id: string; display_name: string; quantity_min: string | null; quantity_max: string | null; base_unit_id: string | null; checked: number; unresolved: number; source_json: string;
  }>();
  const measurementSystem = displaySystem ?? list.measurement_system;
  return { id: list.id, name: list.name, measurementSystem, generatedAt: list.created_at, updatedAt: list.updated_at,
    plan: list.meal_plan_id && list.starts_on && list.ends_on ? { id: list.meal_plan_id, name: list.plan_name ?? `Week of ${list.starts_on}`, startsOn: list.starts_on, endsOn: list.ends_on, mealCount: list.meal_count } : null,
    items: rows.results.map((row) => {
    const unit = row.base_unit_id ? findUnit(row.base_unit_id) : undefined;
    const displayed = row.quantity_min !== null && unit
      ? displayQuantity({ min: Number(row.quantity_min), ...(row.quantity_max === null ? {} : { max: Number(row.quantity_max) }) }, unit, measurementSystem)
      : null;
    return {
      id: row.id,
      name: row.display_name,
      quantityMin: displayed ? String(displayed.quantity.min) : row.quantity_min,
      quantityMax: displayed?.quantity.max === undefined ? null : String(displayed.quantity.max),
      unitId: displayed?.unit.symbol ?? row.base_unit_id,
      checked: Boolean(row.checked),
      unresolved: Boolean(row.unresolved),
      sources: JSON.parse(row.source_json),
    };
  }) };
}

export async function toggleShoppingItem(db: D1Database, householdId: string, itemId: string, checked: boolean) {
  const result = await db.prepare("UPDATE shopping_list_items SET checked = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND shopping_list_id IN (SELECT id FROM shopping_lists WHERE household_id = ?)").bind(checked ? 1 : 0, itemId, householdId).run();
  if (result.meta.changes) await db.prepare("UPDATE shopping_lists SET updated_at=CURRENT_TIMESTAMP WHERE id=(SELECT shopping_list_id FROM shopping_list_items WHERE id=?)").bind(itemId).run();
  return Boolean(result.meta.changes);
}
