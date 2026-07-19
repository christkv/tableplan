import { addDays } from "../domain/planning/dates";

export interface MealPlanItemView {
  id: string;
  recipeId: string;
  recipeName: string;
  plannedDate: string;
  mealSlot: string;
  servings: number;
  notes: string | null;
}

export interface MealPlanView {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  items: MealPlanItemView[];
}

export async function getMealPlan(db: D1Database, householdId: string, startsOn: string, endsOn: string): Promise<MealPlanView | null> {
  const plan = await db.prepare("SELECT id, name, starts_on, ends_on FROM meal_plans WHERE household_id = ? AND starts_on = ? AND ends_on = ? ORDER BY created_at DESC LIMIT 1")
    .bind(householdId, startsOn, endsOn).first<{ id: string; name: string; starts_on: string; ends_on: string }>();
  if (!plan) return null;
  return getMealPlanItems(db, plan);
}

export async function getMealPlanById(db: D1Database, householdId: string, planId: string): Promise<MealPlanView | null> {
  const plan = await db.prepare("SELECT id, name, starts_on, ends_on FROM meal_plans WHERE id = ? AND household_id = ?")
    .bind(planId, householdId).first<{ id: string; name: string; starts_on: string; ends_on: string }>();
  if (!plan) return null;
  return getMealPlanItems(db, plan);
}

async function getMealPlanItems(db: D1Database, plan: { id: string; name: string; starts_on: string; ends_on: string }): Promise<MealPlanView> {
  const items = await db.prepare(`SELECT mpi.id, mpi.recipe_id, r.name recipe_name, mpi.planned_date, mpi.meal_slot, mpi.servings, mpi.notes FROM meal_plan_items mpi JOIN recipes r ON r.id = mpi.recipe_id WHERE mpi.meal_plan_id = ? ORDER BY mpi.planned_date, mpi.meal_slot, mpi.created_at`)
    .bind(plan.id).all<{ id: string; recipe_id: string; recipe_name: string; planned_date: string; meal_slot: string; servings: string; notes: string | null }>();
  return { id: plan.id, name: plan.name, startsOn: plan.starts_on, endsOn: plan.ends_on, items: items.results.map((row) => ({ id: row.id, recipeId: row.recipe_id, recipeName: row.recipe_name, plannedDate: row.planned_date, mealSlot: row.meal_slot, servings: Number(row.servings), notes: row.notes })) };
}

export async function ensureMealPlan(db: D1Database, input: { householdId: string; startsOn: string; endsOn: string; timezone: string; userId: string }) {
  const id = crypto.randomUUID();
  await db.prepare("INSERT OR IGNORE INTO meal_plans (id, household_id, name, starts_on, ends_on, timezone, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, input.householdId, `Week of ${input.startsOn}`, input.startsOn, input.endsOn, input.timezone, input.userId).run();
  const plan = await db.prepare("SELECT id FROM meal_plans WHERE household_id = ? AND starts_on = ? AND ends_on = ? LIMIT 1")
    .bind(input.householdId, input.startsOn, input.endsOn).first<{ id: string }>();
  if (!plan) throw new Error("Meal plan could not be created");
  return plan.id;
}

export async function addMealPlanItem(db: D1Database, input: { householdId: string; planId: string; recipeId: string; date: string; slot: string; servings: number; notes?: string }) {
  const id = crypto.randomUUID();
  const inserted = await db.prepare(`INSERT INTO meal_plan_items (id, meal_plan_id, recipe_id, planned_date, meal_slot, servings, notes)
    SELECT ?, mp.id, r.id, ?, ?, ?, ? FROM meal_plans mp JOIN recipes r ON r.id=?
    WHERE mp.id=? AND mp.household_id=? AND r.status='active' AND (r.visibility='catalog' OR (r.visibility='household' AND r.owner_household_id=?))`)
    .bind(id, input.date, input.slot, String(input.servings), input.notes ?? null, input.recipeId, input.planId, input.householdId, input.householdId).run();
  if (!inserted.meta.changes) throw new Error("Recipe must be shared with this household before it can be planned");
  return id;
}

export async function removeMealPlanItem(db: D1Database, householdId: string, itemId: string) {
  const item = await db.prepare("SELECT mpi.meal_plan_id AS plan_id FROM meal_plan_items mpi JOIN meal_plans mp ON mp.id=mpi.meal_plan_id WHERE mpi.id=? AND mp.household_id=?")
    .bind(itemId, householdId).first<{ plan_id: string }>();
  if (!item) return null;
  await db.prepare("DELETE FROM meal_plan_items WHERE id = ? AND meal_plan_id = ?").bind(itemId, item.plan_id).run();
  return item.plan_id;
}

export function parsePlannedServings(value: unknown): number {
  const servings = Number(value);
  if (!Number.isFinite(servings) || servings < 0.25 || servings > 100) throw new Error("Servings must be between 0.25 and 100");
  return servings;
}

export async function updateMealPlanItemServings(db: D1Database, input: { householdId: string; itemId: string; servings: number }) {
  const servings = parsePlannedServings(input.servings);
  const item = await db.prepare(`SELECT mpi.meal_plan_id AS plan_id FROM meal_plan_items mpi JOIN meal_plans mp ON mp.id=mpi.meal_plan_id
    WHERE mpi.id=? AND mp.household_id=?`).bind(input.itemId, input.householdId).first<{ plan_id: string }>();
  if (!item) throw new Error("Meal plan item not found");
  await db.prepare("UPDATE meal_plan_items SET servings=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND meal_plan_id=?")
    .bind(String(servings), input.itemId, item.plan_id).run();
  return item.plan_id;
}

export class MealPlanCopyError extends Error {
  constructor(public readonly code: "source_empty" | "target_not_empty", message: string) {
    super(message);
    this.name = "MealPlanCopyError";
  }
}

export function shiftPlannedDate(plannedDate: string, sourceStartsOn: string, targetStartsOn: string): string {
  const source = new Date(`${sourceStartsOn}T00:00:00Z`);
  const date = new Date(`${plannedDate}T00:00:00Z`);
  const dayOffset = Math.round((date.getTime() - source.getTime()) / 86_400_000);
  if (!Number.isInteger(dayOffset) || dayOffset < 0 || dayOffset > 6) throw new Error("Plan item date is outside the source week");
  return addDays(targetStartsOn, dayOffset);
}

export async function copyMealPlanWeek(db: D1Database, input: {
  householdId: string;
  userId: string;
  sourceStartsOn: string;
  targetStartsOn: string;
  timezone: string;
}): Promise<{ planId: string; itemCount: number }> {
  const sourceEndsOn = addDays(input.sourceStartsOn, 6);
  const targetEndsOn = addDays(input.targetStartsOn, 6);
  const source = await db.prepare(`
    SELECT mpi.recipe_id, mpi.planned_date, mpi.meal_slot, mpi.servings, mpi.notes, mpi.leftovers
    FROM meal_plan_items mpi
    WHERE mpi.meal_plan_id = (
      SELECT id FROM meal_plans
      WHERE household_id = ? AND starts_on = ? AND ends_on = ?
      ORDER BY created_at DESC, id DESC LIMIT 1
    )
    ORDER BY mpi.planned_date, mpi.meal_slot, mpi.created_at
  `).bind(input.householdId, input.sourceStartsOn, sourceEndsOn).all<{
    recipe_id: string; planned_date: string; meal_slot: string; servings: string; notes: string | null; leftovers: number;
  }>();
  if (!source.results.length) throw new MealPlanCopyError("source_empty", "The previous week has no meals to copy");

  const existingTarget = await getMealPlan(db, input.householdId, input.targetStartsOn, targetEndsOn);
  if (existingTarget?.items.length) throw new MealPlanCopyError("target_not_empty", "The target week already contains meals");
  const planId = existingTarget?.id ?? await ensureMealPlan(db, {
    householdId: input.householdId,
    startsOn: input.targetStartsOn,
    endsOn: targetEndsOn,
    timezone: input.timezone,
    userId: input.userId,
  });
  const statements = source.results.map((item) => db.prepare(`
    INSERT INTO meal_plan_items (id, meal_plan_id, recipe_id, planned_date, meal_slot, servings, notes, leftovers)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    planId,
    item.recipe_id,
    shiftPlannedDate(item.planned_date, input.sourceStartsOn, input.targetStartsOn),
    item.meal_slot,
    item.servings,
    item.notes,
    item.leftovers,
  ));
  await db.batch(statements);
  return { planId, itemCount: statements.length };
}
