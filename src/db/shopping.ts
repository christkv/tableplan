import { aggregateIngredients } from "../domain/quantity/aggregate";
import { displayQuantity } from "../domain/quantity/display";
import type { MeasurementSystem } from "../domain/quantity/types";
import { findUnit } from "../domain/quantity/units";

export interface ShoppingItemView {
  id: string; name: string; quantityMin: string | null; quantityMax: string | null; unitId: string | null;
  checked: boolean; unresolved: boolean; sources: Array<{ recipeId: string; recipeName: string; rawLine: string }>;
}

export interface ShoppingListView { id: string; name: string; measurementSystem: MeasurementSystem; items: ShoppingItemView[] }

export async function generateShoppingList(db: D1Database, input: { householdId: string; planId: string; startsOn: string; endsOn: string; userId: string; measurementSystem: "original" | "us" | "metric" }) {
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
  const aggregates = aggregateIngredients(rows.results.map((row) => ({
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
  const listId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO shopping_lists (id, household_id, meal_plan_id, name, starts_on, ends_on, measurement_system, generation_version, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'v1', ?)")
      .bind(listId, input.householdId, input.planId, `Shopping ${input.startsOn} to ${input.endsOn}`, input.startsOn, input.endsOn, input.measurementSystem, input.userId),
  ];
  aggregates.forEach((item, position) => statements.push(db.prepare(`INSERT INTO shopping_list_items (id, shopping_list_id, ingredient_id, display_name, quantity_min, quantity_max, base_unit_id, dimension, preparation, unresolved, source_json, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), listId, item.canonicalIngredientId ?? null, item.name, item.quantity ? String(item.quantity.min) : null, item.quantity?.max === undefined ? null : String(item.quantity.max), item.unit?.id ?? null, item.unit?.dimension ?? null, item.preparation ?? null, item.unresolved ? 1 : 0, JSON.stringify(item.sources), position)));
  for (let index = 0; index < statements.length; index += 80) await db.batch(statements.slice(index, index + 80));
  return listId;
}

export async function getLatestShoppingList(db: D1Database, householdId: string, displaySystem?: MeasurementSystem): Promise<ShoppingListView | null> {
  const list = await db.prepare("SELECT id, name, measurement_system FROM shopping_lists WHERE household_id = ? ORDER BY created_at DESC LIMIT 1").bind(householdId).first<{ id: string; name: string; measurement_system: MeasurementSystem }>();
  if (!list) return null;
  const rows = await db.prepare("SELECT id, display_name, quantity_min, quantity_max, base_unit_id, checked, unresolved, source_json FROM shopping_list_items WHERE shopping_list_id = ? ORDER BY checked, position").bind(list.id).all<{
    id: string; display_name: string; quantity_min: string | null; quantity_max: string | null; base_unit_id: string | null; checked: number; unresolved: number; source_json: string;
  }>();
  const measurementSystem = displaySystem ?? list.measurement_system;
  return { id: list.id, name: list.name, measurementSystem, items: rows.results.map((row) => {
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
  await db.prepare("UPDATE shopping_list_items SET checked = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND shopping_list_id IN (SELECT id FROM shopping_lists WHERE household_id = ?)").bind(checked ? 1 : 0, itemId, householdId).run();
}
