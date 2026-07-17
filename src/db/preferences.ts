import type { MeasurementSystem } from "../domain/quantity/types";

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
