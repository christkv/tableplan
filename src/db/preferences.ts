import type { MeasurementSystem } from "../domain/quantity/types";
import { parseMealSlotDefinitions, readStoredMealSlots, type MealSlotDefinition } from "../domain/planning/slots";

export function parseMeasurementSystem(value: unknown): MeasurementSystem {
  if (value === "original" || value === "us" || value === "metric") return value;
  throw new Error("Measurement system must be original, metric, or US");
}

export async function getMeasurementSystem(db: D1Database, userId: string, householdId: string): Promise<MeasurementSystem> {
  const row = await db.prepare(`
    SELECT COALESCE(up.preferred_measurement_system, hp.measurement_system, 'original') AS measurement_system
    FROM household_preferences hp
    LEFT JOIN user_profiles up ON up.user_id = ?
    WHERE hp.household_id = ?
  `).bind(userId, householdId).first<{ measurement_system: string }>();
  try {
    return parseMeasurementSystem(row?.measurement_system ?? "original");
  } catch {
    return "original";
  }
}

export async function updateMeasurementSystem(db: D1Database, userId: string, householdId: string, value: unknown): Promise<MeasurementSystem> {
  const measurementSystem = parseMeasurementSystem(value);
  await db.batch([
    db.prepare("UPDATE user_profiles SET preferred_measurement_system = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").bind(measurementSystem, userId),
    db.prepare("UPDATE household_preferences SET measurement_system = ?, updated_at = CURRENT_TIMESTAMP WHERE household_id = ?").bind(measurementSystem, householdId),
  ]);
  return measurementSystem;
}

export async function getMealPlanSlots(db: D1Database, householdId: string): Promise<MealSlotDefinition[]> {
  const row = await db.prepare("SELECT meal_slots_json FROM household_preferences WHERE household_id = ?")
    .bind(householdId).first<{ meal_slots_json: string }>();
  return readStoredMealSlots(row?.meal_slots_json);
}

export async function updateMealPlanSlots(db: D1Database, householdId: string, ids: unknown[], labels: unknown[]): Promise<MealSlotDefinition[]> {
  const slots = parseMealSlotDefinitions(ids, labels);
  await db.prepare("UPDATE household_preferences SET meal_slots_json = ?, updated_at = CURRENT_TIMESTAMP WHERE household_id = ?")
    .bind(JSON.stringify(slots), householdId).run();
  return slots;
}
